// ci-summary.json の組み立て（純粋関数。時刻・環境変数・ファイル読込は呼び出し側から注入する）。
import { renderConsumerContractLines } from "./consumer-contract.mjs";
import { countBy, layerOf, tcIdsOf } from "./junit.mjs";
import { elapsedSec, jobTimings, layerTimings } from "./timing.mjs";

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
    // この記録を作ったジョブ自身の所要（集約ジョブなら数秒）。run 全体の所要は run_duration_sec
    duration_sec: durationSec,
    // run 全体の所要（wall-clock）: run の開始（github.run_started_at）から、この記録を作った時点まで
    run_started_at: env.RUN_STARTED_AT || null,
    run_duration_sec: elapsedSec(env.RUN_STARTED_AT, nowIso),
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
export function buildSummary({ env, nowIso, layerSpecs, artifacts = [], consumerContracts = [] }) {
  const byLayer = groupByLayer(layerSpecs);
  const layers = {};
  for (const l of LAYERS) if (byLayer[l]) layers[l] = countBy(byLayer[l]);
  return {
    ...runInfo(env, nowIso),
    layers,
    test_cases: tcResults(byLayer),
    junit_files: layerSpecs.flatMap((s) => s.files).sort(),
    artifacts,
    consumer_contracts: consumerContracts,
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

/**
 * 層ごとの所要を、その層を流したジョブの実測（開始〜終了）にする。実測が無ければ JUnit のテスト時間のまま（duration_source: junit）。
 * test_time_sec は JUnit のテスト時間の合計（並列のジョブの分も足す）。
 */
function withLayerTimings(layers, timings) {
  const byLayer = layerTimings(timings);
  return Object.fromEntries(
    Object.entries(layers).map(([layer, counts]) => {
      const t = byLayer[layer];
      return [
        layer,
        {
          ...counts,
          test_time_sec: counts.duration_sec,
          duration_sec: t ? t.duration_sec : counts.duration_sec,
          duration_source: t ? "job" : "junit",
          jobs: t?.jobs ?? [],
        },
      ];
    }),
  );
}

function mergeLayersAndCases(summaries) {
  const layers = {};
  const testCases = {};
  for (const s of summaries) {
    for (const [l, c] of Object.entries(s.layers ?? {})) layers[l] = sumLayer(layers[l] ?? emptyCounts(), c);
    mergeTestCases(testCases, s.test_cases ?? {});
  }
  return { layers, testCases };
}

/** 層・ジョブ別の ci-summary を 1 つにまとめる。jobResults は needs.*.result。jobs は GitHub API の run のジョブ一覧（任意）。 */
export function mergeSummaries({ env, nowIso, summaries, jobResults = {}, jobs = [] }) {
  const { layers, testCases } = mergeLayersAndCases(summaries);
  const timings = jobTimings(jobs);
  return {
    ...runInfo(env, nowIso),
    layers: withLayerTimings(layers, timings),
    job_timings: timings,
    test_cases: testCases,
    coverage: Object.assign({}, ...summaries.map((s) => s.coverage ?? {})),
    jobs: jobResults,
    gate: Object.values(jobResults).every((r) => r === "success") ? "pass" : "fail",
    junit_files: summaries.flatMap((s) => s.junit_files ?? []).sort(),
    artifacts: summaries.flatMap((s) => s.artifacts ?? []),
    consumer_contracts: summaries.flatMap((s) => s.consumer_contracts ?? []),
    parts: summaries.map((s) => ({ job: s.job, layers: Object.keys(s.layers ?? {}) })),
  };
}

const layerRow = ([l, c]) =>
  `| ${l} | ${c.total} | ${c.passed} | ${c.failed} | ${c.skipped} | ${c.retried_success} | ${c.duration_sec}s |`;

function footerLines(summary) {
  const cov = Object.entries(summary.coverage ?? {}).map(
    ([n, c]) =>
      `${n}: ${c.error ?? `lines ${c.lines}% / branches ${c.branches}% / functions ${c.functions}%`}`,
  );
  const jobRows = Object.entries(summary.jobs ?? {}).map(([j, r]) => `| ${j} | ${r} |`);
  return [
    ...(cov.length ? ["", `カバレッジ: ${cov.join(" ; ")}`] : []),
    ...renderConsumerContractLines(summary.consumer_contracts),
    ...(jobRows.length ? ["", "| ジョブ | 結果 |", "|---|---|", ...jobRows] : []),
  ];
}

export function renderMarkdown(summary, title = "CI サマリ") {
  const rows = Object.entries(summary.layers).map(layerRow);
  const failed = Object.entries(summary.test_cases).filter(([, r]) => r.status === "failed");
  const lines = [
    `### ${title}`,
    "",
    `- 対象 SHA: \`${summary.commit_sha}\`（run ${summary.run_id} / attempt ${summary.run_attempt} / ${summary.event}）`,
    `- 開始 ${summary.run_started_at ?? summary.started_at} / 所要 ${summary.run_duration_sec ?? summary.duration_sec}s（run 全体）`,
    "",
    "| レイヤー | 合計 | 成功 | 失敗 | スキップ | retry 後成功 | 時間 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...(rows.length ? rows : ["| (結果なし) | 0 | 0 | 0 | 0 | 0 | 0s |"]),
    "",
    `TC-ID 付きの結果: ${Object.keys(summary.test_cases).length} 件（失敗 ${failed.length} 件）`,
  ];
  if (failed.length) lines.push("", `失敗した TC: ${failed.map(([id]) => id).join(", ")}`);
  lines.push(...footerLines(summary));
  return `${lines.join("\n")}\n`;
}
