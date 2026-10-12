// 判定（CLI）。perf/results/<run_id>/ の k6 生データ・観測データ・画面計測を読み、verdict.json を出す。
// 判定規則の本体と説明は lib/rules.mjs（統計量 p95・外れ値の扱い・エラーしきい値・SLO 違反ルール）。
// 使い方: node scripts/perf/verdict.mjs --run-dir perf/results/<run_id> [--slo perf/slo.yaml] [--workload perf/workload.yaml]
// 終了コード: 0 = 全シナリオ pass、1 = どれかが fail、2 = 入力不備。
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { parseArgs, requireArg } from "../lib/cli.mjs";
import { analyzeIteration } from "./lib/iteration.mjs";
import { analyzeScreenObserve } from "./lib/screen-observe.mjs";
import {
  VERDICT_RULE,
  describeSeries,
  describeVariance,
  judgeMetric,
  seriesVariance,
  sloMap,
  verdictLoad,
} from "./lib/rules.mjs";
import { verdictCapacity, verdictSoak, verdictSpike, verdictStress } from "./lib/rules-scenarios.mjs";

const SCENARIOS = ["load", "stress", "spike", "soak", "capacity"];
const SERVICES = ["backend", "frontend", "k6"];
const writeJson = (path, obj) => writeFile(path, `${JSON.stringify(obj, null, 1)}\n`);

async function iterDirs(scDir) {
  const names = (await readdir(scDir)).filter((n) => /^iter-\d+$/.test(n));
  return names.sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))).map((n) => join(scDir, n));
}

function capacitySteps(iterations) {
  const names = new Set(iterations.flatMap((it) => Object.keys(it.segments)));
  return [...names]
    .filter((n) => n.startsWith("step-"))
    .map((n) => Number(n.slice(5)))
    .sort((a, b) => a - b);
}

function judge(scenario, ctx, iterations) {
  const { slo, wl } = ctx;
  if (scenario === "load") return verdictLoad(slo, iterations);
  if (scenario === "stress") {
    const s = wl.scenarios.stress;
    const env = iterations[0].segments.main.env;
    const stageSec = env.STAGE_SEC || s.stage_duration_sec.full;
    // 実際に走らせた段（k6 の env STAGES）を使う。実験で段を変えたときに workload.yaml の段とずれないように
    const stages = env.STAGES ? String(env.STAGES).split(",").map(Number) : s.stages_rps;
    return verdictStress(slo, iterations, stages, stageSec);
  }
  if (scenario === "spike") return verdictSpike(slo, iterations);
  if (scenario === "soak") return verdictSoak(slo, iterations);
  return verdictCapacity(slo, iterations, capacitySteps(iterations), wl.data_volume.normal_tasks);
}

function withVariance(v, warmupSec) {
  const series = v.series || null;
  const text = series ? describeSeries(series) : describeVariance(v.slo_judgements || []);
  return {
    ...v,
    warmup_sec: warmupSec,
    variance_stats: series ? seriesVariance(series) : v.variance_stats,
    variance_stats_text: text,
  };
}

async function scenarioVerdict(runDir, sc, ctx) {
  const scDir = join(runDir, sc);
  const iterations = [];
  for (const d of await iterDirs(scDir)) iterations.push(await analyzeIteration(d, sc, SERVICES));
  const v = withVariance(
    { ...judge(sc, ctx, iterations), iterations: iterations.length },
    ctx.wl.warmup.duration_sec,
  );
  await writeJson(join(scDir, "verdict.json"), v);
  return v;
}

// 画面計測（TC-074）。10 回の p95（線形補間）を screen_ready_ms の SLO と比べる。Lighthouse の値は観測として載せる
async function screenVerdict(runDir, slo) {
  const p = join(runDir, "screen", "screen.json");
  if (!existsSync(p)) return null;
  const screen = JSON.parse(await readFile(p, "utf8"));
  const j = judgeMetric(slo.screen_ready_ms, [screen.ready_ms.p95]);
  const series = { screen_ready_ms: screen.ready_ms.values };
  const v = {
    scenario: "screen",
    status: j.pass ? "pass" : "fail",
    reasons: j.pass
      ? []
      : [`screen_ready_ms: p95 ${j.mean}ms が目標 ${j.operator} ${j.target}ms を満たさない`],
    warnings: [],
    slo_judgements: [j],
    iterations: screen.ready_ms.n,
    series,
    detail: {
      tasks: screen.tasks,
      ready_ms: screen.ready_ms,
      lighthouse: screen.lighthouse && screen.lighthouse.runs,
    },
  };
  const observed = await analyzeScreenObserve(join(runDir, "screen"), ["backend", "frontend"]);
  v.detail.server_observe = observed
    ? { time_aligned_samples: observed.observe.window_samples, ref: "screen/analysis.json#observe" }
    : null;
  const out = withVariance(v, screen.warmup.seconds);
  await writeJson(join(runDir, "screen", "verdict.json"), out);
  return out;
}

function overallOf(verdicts) {
  const failed = verdicts.filter((v) => v.status === "fail");
  return {
    status: failed.length === 0 ? "pass" : "fail",
    reasons: failed.flatMap((v) => v.reasons.map((r) => `${v.scenario}: ${r}`)),
    warnings: verdicts.flatMap((v) => v.warnings.map((w) => `${v.scenario}: ${w}`)),
    verdict_rule: VERDICT_RULE,
    scenarios: Object.fromEntries(
      verdicts.map((v) => [v.scenario, { status: v.status, reasons: v.reasons, warnings: v.warnings }]),
    ),
  };
}

function report(overall) {
  const parts = Object.entries(overall.scenarios).map(([k, v]) => `${k}=${v.status}`);
  console.log(`[verdict] ${overall.status}  ${parts.join(" ")}`);
  for (const r of overall.reasons) console.log(`  fail: ${r}`);
  for (const w of overall.warnings) console.log(`  warn: ${w}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = requireArg(args, "run-dir");
  const slo = sloMap(parse(await readFile(args.slo || "perf/slo.yaml", "utf8")));
  const wl = parse(await readFile(args.workload || "perf/workload.yaml", "utf8"));
  const verdicts = [];
  for (const sc of SCENARIOS.filter((s) => existsSync(join(runDir, s)))) {
    verdicts.push(await scenarioVerdict(runDir, sc, { slo, wl }));
  }
  const screen = await screenVerdict(runDir, slo);
  if (screen) verdicts.push(screen);
  if (verdicts.length === 0) throw new Error("判定する結果が無い");
  const overall = overallOf(verdicts);
  await writeJson(join(runDir, "verdict.json"), overall);
  report(overall);
  process.exit(overall.status === "pass" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
