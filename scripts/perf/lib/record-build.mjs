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

// サーバ側の観測のソース。kind: measured = その量を直接測った値、proxy = 本来見たいものの代用（何の代用かを what に書く）。
// 本物の APM（トレース・アプリ内の処理時間・イベントループ遅延）・DB の問い合わせ指標・キュー・外部依存は取っていない（UNAVAILABLE）。
const SOURCES = [
  [
    "cpu",
    (o) => o.services.backend && o.services.backend.cpu_pct,
    "measured",
    "docker stats --no-stream の backend コンテナの CPU%（1 秒間隔）",
  ],
  [
    "memory",
    (o) => o.services.backend && o.services.backend.memory,
    "measured",
    "docker stats の backend コンテナのメモリ使用量（1 秒間隔）",
  ],
  [
    "db",
    (o) => o.db,
    "proxy",
    "SQLite ファイル（-wal / -shm を含む）のサイズ。DB の処理時間・接続数・ロック待ちは取れない（DB 指標の代用）",
  ],
  [
    "apm",
    (o) => o.health && o.health.n > 0,
    "proxy",
    "health 応答時間（nginx 経由。1 秒間隔）。アプリ内の処理時間・イベントループ遅延を直接見る APM は未導入（APM の代用）",
  ],
];

export const UNAVAILABLE = [
  {
    source: "apm_agent",
    reason:
      "APM エージェント・トレース基盤は未導入（個人用・本番なし。ACT-025 で導入要否を決める）。health 応答時間（proxy）で代用",
  },
  {
    source: "db_query",
    reason:
      "SQLite は組み込みで、問い合わせ時間・接続数・ロック待ちを外から取れない（DB ファイルのサイズだけ proxy で取る）",
  },
  { source: "queue", reason: "構成にキューが無い（frontend → backend → SQLite のみ）" },
  { source: "external_dependency", reason: "外部依存（外部 API・外部 DB）が無い" },
];

// 観測できた指標のソース。時刻整合 = 計測の窓（k6 の最初〜最後の要求、画面計測は screen.json の started_at〜finished_at）の中にサンプルがあること
function serverMetrics(observe, scenario) {
  if (!observe) return [];
  const aligned = observe.window_samples > 0;
  const ref =
    scenario === "screen" ? "screen/analysis.json#observe" : `${scenario}/iter-N/analysis.json#observe`;
  return SOURCES.filter(([, has]) => has(observe)).map(([source, , kind, what]) => ({
    source,
    kind,
    what,
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
    env_class: run.env_class,
    comparison: ctx.comparison || null,
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
    server_metrics_unavailable: UNAVAILABLE,
    verdict: v.status,
    verdict_rule: { ...VERDICT_RULE },
    started_at: run.started_at,
  };
}

export function buildRuns(ctx, verdicts) {
  return verdicts.map((v) => buildRun(ctx, v));
}

const SOURCE_INFO = Object.fromEntries(SOURCES.map(([source, , kind, what]) => [source, { kind, what }]));

// すでにある記録（perf-runs.json の 1 件）に、env_class・比較条件・観測ソースの kind / what・取れないものの一覧を足す。他の項目は変えない。
// 古い run の記録を書き直すときに使う（backfill-record.mjs）。冪等。
export function annotateRun(entry, envClass, comparison) {
  return {
    ...entry,
    env_class: entry.env_class || envClass,
    comparison: comparison || null,
    server_metrics: (entry.server_metrics || []).map((m) => ({ ...m, ...(SOURCE_INFO[m.source] || {}) })),
    server_metrics_unavailable: UNAVAILABLE,
  };
}
