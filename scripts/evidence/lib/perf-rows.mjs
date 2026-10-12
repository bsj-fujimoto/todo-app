// 性能層（perf 層。k6 の load と画面計測）の判定を、実施表（docs/data/executions.csv）の行にする。純粋関数。
// 1 行 = 1 ケース × 1 実行環境 × 1 run（kind=performance）。結び付けは perf/slo.yaml の SLO ごとの test_cases（正本）。
// 機能層の TC-073・TC-074 は番兵で、本判定は perf 層（ADR-0005）。この行が、その本判定の結果。
// actual_result は verdict.json の SLO 判定（反復ごとの値の平均・目標・合否）から作る。期待結果の転記はしない。
import { uniq } from "./common.mjs";

/** 判定を持つシナリオ（perf 層の結果ディレクトリの下のディレクトリ名）。 */
export const JUDGED_SCENARIOS = ["load", "screen"];

const round = (v) => Number(Number(v).toPrecision(4));
const valueText = (v, unit) => `${round(v)}${unit === "ms" ? "ms" : ""}`;

/** 判定の根拠の書き方。load は k6 の反復ごとの p95 の平均、screen は 10 回の計測の p95（scripts/perf/verdict.mjs の規則）。 */
const BASIS = {
  load: (j) => `${j.values.length} 反復の平均`,
  screen: (_j, verdict) => `${verdict.iterations} 回の計測の p95`,
};

/** SLO の判定 1 つの文。 */
export function judgementText(j) {
  return `${j.metric} ${valueText(j.mean, j.unit)}（目標 ${j.operator} ${valueText(j.target, j.unit)}、${j.basis}。${j.pass ? "達成" : "未達"}）`;
}

/** verdicts: { load: verdict.json, screen: verdict.json } → [{ scenario, basis, ...判定 }]。 */
export function collectJudgements(verdicts) {
  return JUDGED_SCENARIOS.flatMap((scenario) =>
    (verdicts[scenario]?.slo_judgements ?? []).map((j) => ({
      ...j,
      scenario,
      basis: BASIS[scenario](j, verdicts[scenario]),
    })),
  );
}

/** SLO の定義（perf/slo.yaml の slos）→ metric → test_cases。 */
const casesOf = (slos) => new Map((slos ?? []).map((s) => [s.metric, s.test_cases ?? []]));

/** 判定をケースごとにまとめる。test_cases が無い SLO（TC に結び付かない）は行にしない。 */
export function groupByCase(judgements, slos, caseIds) {
  const map = casesOf(slos);
  const groups = new Map();
  for (const j of judgements) {
    for (const tc of (map.get(j.metric) ?? []).filter((id) => caseIds.has(id))) {
      groups.set(tc, [...(groups.get(tc) ?? []), j]);
    }
  }
  return groups;
}

export const statusOfJudgements = (list) => (list.every((j) => j.pass) ? "pass" : "fail");

/** 実施環境の文（run.json の env_class・host）。 */
export function perfEnvironment(run) {
  const host = run.host ?? {};
  return [
    "perf（k6・画面計測）",
    run.env_class,
    `profile ${run.profile}`,
    host.os_release ? `Linux ${host.os_release} ${host.arch}` : null,
    host.node ? `Node ${host.node}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

/**
 * ctx: { runId, sha, run（run.json）, verdicts, slos, caseIds, evidenceFor(scenario) → 証拠の項目, runEntry（run.json の項目） }。
 * 戻り値: 行（execution_id なし。_evidence に証拠索引の項目）。TC の昇順。
 */
export function buildPerfRows(ctx) {
  const groups = groupByCase(collectJudgements(ctx.verdicts), ctx.slos, ctx.caseIds);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tc, list]) => {
      const status = statusOfJudgements(list);
      return {
        test_case_id: tc,
        kind: "performance",
        run_ref: `gh-run-${ctx.runId}`,
        commit_sha: ctx.sha,
        environment: perfEnvironment(ctx.run),
        status,
        actual_result: `perf 層の SLO 判定: ${list.map(judgementText).join("、")}。`,
        evidence_ids: "",
        _evidence: [...uniq(list.map((j) => j.scenario)).map(ctx.evidenceFor), ctx.runEntry],
        defect_ids: "",
        executed_at: ctx.run.started_at,
        executor: "GitHub Actions",
        reason: "",
        owner: "",
        retest_due: "",
        _layer: "perf",
      };
    });
}
