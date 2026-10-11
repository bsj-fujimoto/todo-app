// 段（stress の到着率）・フェーズ（spike）ごとに、観測（CPU・メモリ・health 応答）と k6 の結果を時刻で突き合わせる。
// ボトルネック分析（perf/analysis.md）の根拠: どの段で CPU が飽和し、そのとき health の応答（イベントループの待ち）と取りこぼし・エラーがどうなったか。
// 使い方: node scripts/perf/stage-report.mjs --run-dir perf/results/<run_id> [--scenario stress|spike]
//   出力: <run-dir>/<scenario>/stage-resources.json（段ごとの値。反復ごと）と、標準出力の Markdown 表（反復の平均）
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, requireArg } from "../lib/cli.mjs";
import { readK6Raw } from "./lib/k6raw.mjs";
import { parseJsonl } from "./lib/observe-parse.mjs";
import { mean, percentile, round } from "./lib/stats.mjs";

const TAGS = { stress: "stage", spike: "phase" };

function windowsOf(raw, tag) {
  const w = new Map();
  for (const d of raw.durations) {
    const key = d[tag];
    if (key === undefined) continue;
    const cur = w.get(key) || { start: d.ms, end: d.ms, n: 0, ok: 0, e5xx: 0 };
    cur.start = Math.min(cur.start, d.ms);
    cur.end = Math.max(cur.end, d.ms);
    cur.n += 1;
    if (Number(d.status) >= 500) cur.e5xx += 1;
    w.set(key, cur);
  }
  return w;
}

const within = (rec, w) => {
  const t = Date.parse(rec.ts);
  return t >= w.start && t <= w.end;
};

function cpuStats(obs, service, w) {
  const v = obs
    .filter((r) => r.kind === "docker_stats" && r.service === service && within(r, w))
    .map((r) => r.cpu_pct);
  return v.length
    ? { mean: round(mean(v), 1), p95: round(percentile(v, 0.95), 1), max: round(Math.max(...v), 1) }
    : null;
}

function healthStats(obs, w) {
  const v = obs.filter((r) => r.kind === "health" && r.ms !== null && within(r, w)).map((r) => r.ms);
  return v.length
    ? {
        n: v.length,
        p50_ms: round(percentile(v, 0.5), 1),
        p95_ms: round(percentile(v, 0.95), 1),
        max_ms: round(Math.max(...v), 1),
      }
    : null;
}

function memStats(obs, service, w) {
  const v = obs
    .filter((r) => r.kind === "docker_stats" && r.service === service && within(r, w))
    .map((r) => r.mem_bytes / 1024 ** 2);
  return v.length ? { mean_mib: round(mean(v), 1), max_mib: round(Math.max(...v), 1) } : null;
}

function rowFor(key, w, obs) {
  const secs = (w.end - w.start) / 1000;
  return {
    key,
    seconds: round(secs, 1),
    requests: w.n,
    achieved_rps: secs > 0 ? round(w.n / secs, 1) : null,
    responses_5xx: w.e5xx,
    backend_cpu: cpuStats(obs, "backend", w),
    frontend_cpu: cpuStats(obs, "frontend", w),
    k6_cpu: cpuStats(obs, "k6", w),
    backend_mem: memStats(obs, "backend", w),
    health: healthStats(obs, w),
  };
}

async function iteration(dir, tag) {
  const raw = await readK6Raw(join(dir, "main.raw.json.gz"));
  const obs = parseJsonl(readFileSync(join(dir, "observe.jsonl"), "utf8"));
  const rows = [];
  for (const [key, w] of windowsOf(raw, tag)) rows.push(rowFor(key, w, obs));
  return rows.sort((a, b) => Number(a.key) - Number(b.key) || String(a.key).localeCompare(String(b.key)));
}

function avg(rows, pick) {
  const v = rows.map(pick).filter((x) => x !== null && x !== undefined);
  return v.length ? round(mean(v), 1) : null;
}

function table(perIter) {
  const keys = perIter[0].map((r) => r.key);
  const lines = [
    "| 段 / フェーズ | 達成 req/s | 5xx 応答 | backend CPU 平均 / 最大 (%) | frontend CPU 平均 (%) | k6 CPU 平均 (%) | backend メモリ最大 (MiB) | health p50 / p95 / 最大 (ms) |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const key of keys) {
    const rows = perIter.map((it) => it.find((r) => r.key === key)).filter(Boolean);
    const f = (pick) => avg(rows, pick);
    lines.push(
      `| ${key} | ${f((r) => r.achieved_rps)} | ${f((r) => r.responses_5xx)} | ${f((r) => r.backend_cpu && r.backend_cpu.mean)} / ${f((r) => r.backend_cpu && r.backend_cpu.max)} | ${f((r) => r.frontend_cpu && r.frontend_cpu.mean)} | ${f((r) => r.k6_cpu && r.k6_cpu.mean)} | ${f((r) => r.backend_mem && r.backend_mem.max_mib)} | ${f((r) => r.health && r.health.p50_ms)} / ${f((r) => r.health && r.health.p95_ms)} / ${f((r) => r.health && r.health.max_ms)} |`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = requireArg(args, "run-dir");
  const scenario = args.scenario || "stress";
  const scDir = join(runDir, scenario);
  const iters = readdirSync(scDir)
    .filter((n) => /^iter-\d+$/.test(n))
    .sort();
  const perIter = [];
  for (const it of iters) perIter.push(await iteration(join(scDir, it), TAGS[scenario]));
  writeFileSync(
    join(scDir, "stage-resources.json"),
    `${JSON.stringify({ scenario, iterations: perIter }, null, 1)}\n`,
  );
  console.log(table(perIter));
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
