// ci-summary.json の組み立て（純粋関数。時刻・環境変数・ファイル読込は呼び出し側から注入する）。
import { countBy, layerOf, tcIdsOf } from "./junit.mjs";

export const LAYERS = ["unit", "api", "contract", "e2e", "compose"];
const emptyCounts = () => ({
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  retried_success: 0,
  duration_sec: 0,
});
const emptyTc = () => ({ status: "passed", runs: 0, passed: 0, failed: 0, skipped: 0, layers: [] });

export function runInfo(env, nowIso) {
  const e = (k) => env[k] ?? null;
  const started = env.CI_STARTED_AT || nowIso;
  const durationSec = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(started)) / 1000));
  return {
    schema_version: 1,
    repository: e("GITHUB_REPOSITORY"),
    // pull_request では merge commit ではなく PR の head SHA を対象とする（workflow が TARGET_SHA に入れる）
    commit_sha: env.TARGET_SHA || e("GITHUB_SHA"),
    ref: e("GITHUB_REF_NAME"),
    run_id: e("GITHUB_RUN_ID"),
    run_attempt: e("GITHUB_RUN_ATTEMPT"),
    workflow: e("GITHUB_WORKFLOW"),
    event: e("GITHUB_EVENT_NAME"),
    job: e("GITHUB_JOB"),
    started_at: started,
    finished_at: nowIso,
    duration_sec: durationSec,
  };
}

function groupByLayer(layerSpecs) {
  const byLayer = {};
  for (const spec of layerSpecs) {
    for (const tc of spec.cases) (byLayer[layerOf(tc, spec.layer)] ??= []).push(tc);
  }
  return byLayer;
}

function finalizeTc(r) {
  r.status = r.failed > 0 ? "failed" : r.passed > 0 ? "passed" : "skipped";
  r.flaky = r.failed > 0 && r.passed > 0;
  return r;
}

function addRun(out, layer, tc) {
  for (const id of tcIdsOf(tc.name)) {
    const r = (out[id] ??= emptyTc());
    r.runs += 1;
    r[tc.status] += 1;
    if (!r.layers.includes(layer)) r.layers.push(layer);
  }
}

function tcResults(byLayer) {
  const out = {};
  for (const [layer, cases] of Object.entries(byLayer)) cases.forEach((tc) => addRun(out, layer, tc));
  Object.values(out).forEach(finalizeTc);
  return out;
}

/** layerSpecs: [{ layer, cases, files }] */
export function buildSummary({ env, nowIso, layerSpecs, artifacts = [] }) {
  const byLayer = groupByLayer(layerSpecs);
  const layers = {};
  for (const l of LAYERS) if (byLayer[l]) layers[l] = countBy(byLayer[l]);
  return {
    ...runInfo(env, nowIso),
    layers,
    test_cases: tcResults(byLayer),
    junit_files: layerSpecs.flatMap((s) => s.files).sort(),
    artifacts,
  };
}

const sumLayer = (a, b) => ({
  total: a.total + b.total,
  passed: a.passed + b.passed,
  failed: a.failed + b.failed,
  skipped: a.skipped + b.skipped,
  retried_success: a.retried_success + b.retried_success,
  duration_sec: Math.round((a.duration_sec + b.duration_sec) * 1000) / 1000,
});

function mergeTestCases(target, source) {
  for (const [id, r] of Object.entries(source)) {
    const t = (target[id] ??= emptyTc());
    for (const k of ["runs", "passed", "failed", "skipped"]) t[k] += r[k];
    t.layers = [...new Set([...t.layers, ...r.layers])];
    finalizeTc(t);
  }
}

/** 層・ジョブ別の ci-summary を 1 つにまとめる。jobResults は needs.*.result。 */
export function mergeSummaries({ env, nowIso, summaries, jobResults = {} }) {
  const layers = {};
  const testCases = {};
  for (const s of summaries) {
    for (const [l, c] of Object.entries(s.layers ?? {})) layers[l] = sumLayer(layers[l] ?? emptyCounts(), c);
    mergeTestCases(testCases, s.test_cases ?? {});
  }
  return {
    ...runInfo(env, nowIso),
    layers,
    test_cases: testCases,
    coverage: Object.assign({}, ...summaries.map((s) => s.coverage ?? {})),
    jobs: jobResults,
    gate: Object.values(jobResults).every((r) => r === "success") ? "pass" : "fail",
    junit_files: summaries.flatMap((s) => s.junit_files ?? []).sort(),
    artifacts: summaries.flatMap((s) => s.artifacts ?? []),
    parts: summaries.map((s) => ({ job: s.job, layers: Object.keys(s.layers ?? {}) })),
  };
}

const layerRow = ([l, c]) =>
  `| ${l} | ${c.total} | ${c.passed} | ${c.failed} | ${c.skipped} | ${c.retried_success} | ${c.duration_sec}s |`;

export function renderMarkdown(summary, title = "CI サマリ") {
  const rows = Object.entries(summary.layers).map(layerRow);
  const failed = Object.entries(summary.test_cases).filter(([, r]) => r.status === "failed");
  const lines = [
    `### ${title}`,
    "",
    `- 対象 SHA: \`${summary.commit_sha}\`（run ${summary.run_id} / attempt ${summary.run_attempt} / ${summary.event}）`,
    `- 開始 ${summary.started_at} / 所要 ${summary.duration_sec}s`,
    "",
    "| レイヤー | 合計 | 成功 | 失敗 | スキップ | retry 後成功 | 時間 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...(rows.length ? rows : ["| (結果なし) | 0 | 0 | 0 | 0 | 0 | 0s |"]),
    "",
    `TC-ID 付きの結果: ${Object.keys(summary.test_cases).length} 件（失敗 ${failed.length} 件）`,
  ];
  if (failed.length) lines.push("", `失敗した TC: ${failed.map(([id]) => id).join(", ")}`);
  const cov = Object.entries(summary.coverage ?? {}).map(
    ([n, c]) =>
      `${n}: ${c.error ?? `lines ${c.lines}% / branches ${c.branches}% / functions ${c.functions}%`}`,
  );
  if (cov.length) lines.push("", `カバレッジ: ${cov.join(" ; ")}`);
  if (summary.jobs) {
    const jobRows = Object.entries(summary.jobs).map(([j, r]) => `| ${j} | ${r} |`);
    lines.push("", "| ジョブ | 結果 |", "|---|---|", ...jobRows);
  }
  return `${lines.join("\n")}\n`;
}
