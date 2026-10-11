// 外形監視の実行（CLI, composition root）。monitoring/monitors.yaml を読み、有効な監視を定義どおりの timeout・retry で実行する。
// 依存は yaml のみ（HTTP は Node の fetch、ブラウザ監視は e2e/synthetic の Playwright を起動）。
//   出力: <out>/run-history.jsonl（追記。monitor_id, at, result, duration_ms, failure_detail, version ほか）
//         <out>/results.json（今回の結果。alert.mjs が読む）、<out>/summary.md（$GITHUB_STEP_SUMMARY にも追記）
// 使い方: node scripts/monitoring/run-monitors.mjs --base-url http://localhost:8080 --out monitoring/out
//         [--only MON-001,MON-002] [--phase normal|drill-fail|drill-recover] [--target target.json] [--markers deployment-markers.jsonl]
// 終了コード: 0 = 通知対象の失敗なし、1 = 通知対象の失敗あり（抑制した失敗は数えない）。drill-fail は失敗が起きなければ 1（注入が効いていない）。
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { parseArgs } from "../lib/cli.mjs";
import { runMonitor, severityOf, withDefaults } from "./lib/runner.mjs";
import { renderSummary } from "./lib/summary.mjs";

const readYaml = (p) => parse(readFileSync(p, "utf8"));
const readJsonl = (p) =>
  existsSync(p)
    ? readFileSync(p, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

function spawnFn(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...opts.env } });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function probeVersion(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
    const h = await res.json();
    return `${h.version}@${String(h.commit).slice(0, 7)}`;
  } catch {
    return null;
  }
}

function targetInfo(args) {
  const path = args.target || "target.json";
  const t = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const pick = (argName, key, envName) => args[argName] || t[key] || process.env[envName] || "";
  return {
    mode: t.mode || process.env.TARGET_MODE || "unknown",
    expected_version: pick("expected-version", "expected_version", "EXPECTED_VERSION"),
    expected_commit: pick("expected-commit", "expected_commit", "EXPECTED_COMMIT"),
  };
}

function writeOutputs(out, outcome, skipped, names) {
  const { run, records } = outcome;
  const results = records.map((r) => ({ ...r, ...names[r.monitor_id] }));
  writeFileSync(join(out, "results.json"), `${JSON.stringify({ run, results, skipped }, null, 2)}\n`);
  const summary = renderSummary(run, results, skipped);
  writeFileSync(join(out, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  return summary;
}

function buildDeps() {
  return {
    fetchFn: fetch,
    now: () => performance.now(),
    wallMs: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    spawnFn,
  };
}

async function buildRun(args, baseUrl) {
  const stamp = new Date().toISOString();
  return {
    run_id: args["run-id"] || process.env.GITHUB_RUN_ID || stamp.replace(/[-:.]/g, "").slice(0, 15),
    phase: args.phase || "normal",
    started_at: stamp,
    region: process.env.GITHUB_ACTIONS ? "github-hosted-runner" : "local-docker",
    retry_delay_sec: Number(args["retry-delay-sec"] ?? 5),
    version: await probeVersion(baseUrl),
    ...targetInfo(args),
  };
}

function buildEnv(args, baseUrl, run, out) {
  const vars = {
    BASE_URL: baseUrl,
    run_id: run.run_id,
    expected_version: run.expected_version,
    expected_commit: run.expected_commit,
  };
  return {
    deps: buildDeps(),
    run,
    ctx: {
      baseUrl,
      openapi: readYaml("backend/openapi.yaml"),
      vars,
      playwrightOut: resolve(out, "playwright"),
    },
    // 通知試験（drill）は通知経路を確かめるのが目的なので、抑制は評価しない（抑制の確認は単体テストと通常の実行で行う）
    maintenance: run.phase.startsWith("drill") ? {} : readYaml("monitoring/maintenance.yaml"),
    markers: readJsonl(args.markers || join(out, "deployment-markers.jsonl")),
  };
}

async function executeAll(monitors, env, routes, out) {
  const records = [];
  const names = {};
  for (const m of monitors) {
    const { record } = await runMonitor(m, env);
    records.push(record);
    names[m.monitor_id] = {
      name: m.name,
      type: m.type,
      severity: severityOf(routes, m.monitor_id),
      journey_id: m.journey_id,
      user_impact: m.user_impact,
      slo_ref: m.slo_ref,
    };
    appendFileSync(join(out, "run-history.jsonl"), `${JSON.stringify(record)}\n`);
    const detail = record.failure_detail ? ` ${record.failure_detail}` : "";
    console.log(`[monitor] ${record.monitor_id} ${record.result} ${record.duration_ms}ms${detail}`);
  }
  return { records, names };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args["base-url"] || process.env.BASE_URL || "http://localhost:8080";
  const out = args.out || "monitoring/out";
  mkdirSync(out, { recursive: true });
  const cfg = readYaml(args.monitors || "monitoring/monitors.yaml");
  const run = await buildRun(args, baseUrl);
  const only = args.only ? args.only.split(",") : null;
  const all = cfg.monitors
    .map((m) => withDefaults(m, cfg.defaults))
    .filter((m) => !only || only.includes(m.monitor_id));
  const { records, names } = await executeAll(
    all.filter((m) => m.enabled),
    buildEnv(args, baseUrl, run, out),
    readYaml("monitoring/alert-routes.yaml"),
    out,
  );
  const skipped = all
    .filter((m) => !m.enabled)
    .map((m) => ({
      monitor_id: m.monitor_id,
      name: m.name,
      type: m.type,
      disabled_reason: m.disabled_reason,
    }));
  writeOutputs(out, { run, records }, skipped, names);
  const alerting = records.filter((r) => r.result === "fail" && !r.alert_suppressed);
  const expectFailure = run.phase === "drill-fail";
  process.exit(alerting.length > 0 === expectFailure ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
