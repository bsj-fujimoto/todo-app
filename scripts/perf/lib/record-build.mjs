// run.json・verdict・分析結果から、qc-analyzer が読める形（PerfRun）の記録を組み立てる。純関数。
import { VERDICT_RULE } from "./rules.mjs";

const TOOLS = { screen: "playwright + lighthouse" };

export function environmentLabel(run) {
  const h = run.host;
  const where = run.runner.github_actions
    ? `GitHub-hosted runner (${run.runner.image_os || "ubuntu"} ${run.runner.image_version || ""})`
    : `local ${h.platform} ${h.arch}`;
  const gib = (run.docker.vm.mem_total_bytes / 1024 ** 3).toFixed(1);
  return `${where} / ${h.cpu_model} ${h.cpu_count} cores / Docker ${run.docker.server_version} VM ${run.docker.vm.ncpu} vCPU ${gib} GiB`;
}

const SOURCES = [
  ["cpu", (o) => o.services.backend && o.services.backend.cpu_pct],
  ["memory", (o) => o.services.backend && o.services.backend.memory],
  ["db", (o) => o.db],
  ["apm", (o) => o.health && o.health.n > 0],
];

// 観測できた指標のソース。時刻整合 = k6 の計測窓の中にサンプルがあること
function serverMetrics(observe, scenario) {
  if (!observe) return [];
  const aligned = observe.window_samples > 0;
  const ref = `${scenario}/iter-N/analysis.json#observe`;
  return SOURCES.filter(([, has]) => has(observe)).map(([source]) => ({
    source,
    time_aligned: aligned,
    ref,
  }));
}

function scriptFor(scenario) {
  if (scenario === "capacity") return "perf/k6/capacity-step.js";
  return scenario === "screen" ? "perf/screen/measure.mjs" : `perf/k6/${scenario}.js`;
}

function toolVersion(run, scenario) {
  if (scenario === "screen") return "playwright-core 1.64.0 + lighthouse 13.5.0 (perf/screen/Dockerfile)";
  return run.k6.version.split("\n")[0];
}

export function buildRun(ctx, v) {
  const { run, envDoc, metrics, analyses } = ctx;
  const first = (analyses[v.scenario] || [])[0];
  const script = scriptFor(v.scenario);
  const own = Object.entries(metrics).filter(([k]) => k.startsWith(`${v.scenario}.`));
  return {
    run_id: `${run.run_id}/${v.scenario}`,
    type: v.scenario,
    environment: environmentLabel(run),
    env_diff: envDoc.env_diff,
    data_profile: envDoc.data_profile,
    tool: TOOLS[v.scenario] || "k6",
    tool_version: toolVersion(run, v.scenario),
    script_path: script,
    script_sha: run.script_sha256[script] || null,
    config_sha: run.config_sha256["perf/workload.yaml"],
    commit_sha: run.commit_sha,
    warmup_sec: v.warmup_sec,
    iterations: v.iterations,
    variance_stats: v.variance_stats_text || null,
    metrics: Object.fromEntries(own),
    server_metrics: serverMetrics(first && first.observe, v.scenario),
    verdict: v.status,
    verdict_rule: { ...VERDICT_RULE },
    started_at: run.started_at,
  };
}

export function buildRuns(ctx, verdicts) {
  return verdicts.map((v) => buildRun(ctx, v));
}
