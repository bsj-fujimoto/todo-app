// 観測サンプラー（composition root: 時刻・プロセス起動・ネットワークを直接扱う唯一の層）。
// 負荷試験と並走させ、1 秒ごとに次を UTC タイムスタンプ付きの JSONL で追記する。
//   docker_stats : docker stats --no-stream の CPU・メモリ・PID・ネットワーク（サービスごと）
//   health       : GET <base-url>/api/v1/health の応答時間（nginx 経由。応答時間が伸びる＝Node のイベントループ待ち・飽和の指標）
//   db           : docker exec で SQLite のファイルサイズ（-wal / -shm を含む）
// 停止は SIGINT / SIGTERM。実行例は perf/README.md を参照。
import { execFile } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { parseArgs, requireArg } from "../lib/cli.mjs";
import { parseDbFiles, parseStatsRecord } from "./lib/observe-parse.mjs";

const run = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const out = requireArg(args, "out");
const project = args.project || "todo-perf";
const baseUrl = args["base-url"] || "http://localhost:8080";
const dbDir = args["db-dir"] || "/data";
const intervalMs = parseInt(args["interval-ms"] || "1000", 10);
const services = (args.services || "backend,frontend").split(",");
const k6Container = args["k6-container"] || null;
const MAX_IN_FLIGHT = 4;

const clock = () => new Date().toISOString();
const emit = (rec) => appendFileSync(out, `${JSON.stringify(rec)}\n`);

async function containerIds() {
  const ids = {};
  for (const s of services) {
    const { stdout } = await run("docker", ["compose", "-p", project, "ps", "-q", s]);
    ids[s] = stdout.trim();
  }
  return ids;
}

async function sampleStats(ids) {
  const { stdout } = await run("docker", [
    "stats",
    "--no-stream",
    "--format",
    "{{json .}}",
    ...Object.values(ids),
  ]);
  const ts = clock();
  for (const line of stdout.split("\n").filter(Boolean)) {
    const rec = JSON.parse(line);
    const service = services.find((s) => ids[s].startsWith(rec.ID) || rec.ID.startsWith(ids[s].slice(0, 12)));
    if (service) emit({ kind: "docker_stats", ts, ...parseStatsRecord(rec, service) });
  }
}

// 負荷生成側（k6 コンテナ）の CPU。被試験側でなく生成側が詰まっていないか（取りこぼしの原因切り分け）を見るため。無ければ何もしない
async function sampleK6(name) {
  try {
    const { stdout } = await run("docker", ["stats", "--no-stream", "--format", "{{json .}}", name]);
    const rec = JSON.parse(stdout.trim().split("\n")[0]);
    emit({ kind: "docker_stats", ts: clock(), ...parseStatsRecord(rec, "k6") });
  } catch {
    // k6 コンテナがまだ無い・もう無い
  }
}

async function probeHealth() {
  const t0 = performance.now();
  try {
    const res = await fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
    const body = await res.json();
    return { status: res.status, body_ok: body.status === "ok", ms: performance.now() - t0 };
  } catch {
    return { status: null, body_ok: null, ms: null };
  }
}

async function sampleHealth() {
  emit({ kind: "health", ts: clock(), target: "frontend-proxy", ...(await probeHealth()) });
}

async function sampleDb(id) {
  const cmd = `for f in ${dbDir}/*; do stat -c '%n %s' "$f"; done`;
  try {
    const { stdout } = await run("docker", ["exec", id, "sh", "-c", cmd]);
    const files = parseDbFiles(stdout);
    emit({
      kind: "db",
      ts: clock(),
      service: "backend",
      bytes: Object.values(files).reduce((a, b) => a + b, 0),
      files,
      error: null,
    });
  } catch (e) {
    emit({
      kind: "db",
      ts: clock(),
      service: "backend",
      bytes: null,
      files: {},
      error: String(e.message).slice(0, 200),
    });
  }
}

async function main() {
  writeFileSync(out, "");
  const ids = await containerIds();
  emit({
    kind: "meta",
    ts: clock(),
    project,
    base_url: baseUrl,
    interval_ms: intervalMs,
    services: ids,
    db_dir: dbDir,
    clock: "UTC (Date#toISOString)",
    note: "docker stats --no-stream は 1 回に約 1 秒かかるため、tick を重ねて実行し 1 秒間隔を保つ",
  });
  let inFlight = 0;
  const tick = () => {
    if (inFlight >= MAX_IN_FLIGHT) return;
    inFlight += 1;
    const jobs = [sampleStats(ids), sampleHealth(), sampleDb(ids.backend)];
    if (k6Container) jobs.push(sampleK6(k6Container));
    Promise.allSettled(jobs).finally(() => {
      inFlight -= 1;
    });
  };
  const timer = setInterval(tick, intervalMs);
  const stop = () => {
    clearInterval(timer);
    const wait = () => (inFlight > 0 ? setTimeout(wait, 100) : process.exit(0));
    wait();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  tick();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
