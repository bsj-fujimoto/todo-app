// 実施表の検査（生成時と check-evidence の両方で使う）。純粋関数。指摘は report（error / warn）へ出す。
import { idsIn, isIso, uniq } from "./common.mjs";
import { classify } from "./executions.mjs";

export const STATUSES = ["pass", "fail", "blocked", "not_run", "skipped"];
export const KINDS = ["automated", "regression", "manual"];
const norm = (text) => String(text).replace(/\s+/g, "");
const done = (r) => ["pass", "fail"].includes(r.status);
const pending = (r) => ["blocked", "not_run"].includes(r.status);

/** 実測値の質: 短すぎ・期待結果の転記（完全一致・全文を含む）を検出する。 */
export function checkActualResults(rows, testCases, report) {
  const expected = new Map(testCases.map((c) => [c.test_case_id, norm(c.expected_result)]));
  for (const r of rows.filter(done)) {
    const actual = norm(r.actual_result);
    const exp = expected.get(r.test_case_id) ?? "";
    if (exp && actual === exp) report.error(`${r.test_case_id} の actual_result が期待結果と同一（転記）`);
    else if (actual.length < 8) report.warn(`${r.test_case_id} の actual_result が短すぎる（8 文字未満）`);
    else if (exp.length >= 20 && actual.includes(exp))
      report.warn(`${r.test_case_id} の actual_result が期待結果の全文を含む（転記の疑い）`);
  }
}

/** 版の混在（commit_sha が 2 種類以上）。release を渡すとその SHA 以外も指摘する。 */
export function checkSingleVersion(rows, report, release = null) {
  const shas = uniq(rows.map((r) => r.commit_sha));
  const short = (s) => s.slice(0, 7);
  if (shas.length > 1)
    report.error(`実施表に commit_sha が ${shas.length} 種類混在: ${shas.map(short).join(", ")}`);
  const foreign = release ? shas.filter((s) => !s.startsWith(release) && !release.startsWith(s)) : [];
  for (const sha of foreign)
    report.error(`リリース SHA ${short(release)} と異なる版の行がある: ${short(sha)}`);
}

const differs = (actual, expected, local) => actual !== local && String(actual) !== String(expected);

/** 観察値が別の版・別の run のものでない（版の混在の検知）。ローカル採取（local）は run の版と比べない。 */
export function checkObservationRun(observations, run, report) {
  const entries = [...observations.values()].flat();
  for (const e of entries) {
    const bad = differs(e.run?.commit_sha, run.sha, "local") || differs(e.run?.run_id, run.runId, "local");
    if (bad)
      report.error(
        `観察値 ${e._file} の版・run が取り込んだ run と違う（${e.run?.commit_sha} / ${e.run?.run_id}）`,
      );
  }
}

/** JUnit の層ごとの件数が ci-summary.json と一致する（取り込み漏れ・別 run の混入の検知）。 */
export function checkAgainstSummary(junitCases, summary, report) {
  if (!summary) {
    report.warn("ci-summary.json が無いので、JUnit の件数を突き合わせられない");
    return;
  }
  const counts = {};
  for (const c of junitCases) counts[classify(c).layer] = (counts[classify(c).layer] ?? 0) + 1;
  for (const [layer, c] of Object.entries(summary.layers ?? {})) {
    const got = counts[layer] ?? 0;
    if (got !== c.total)
      report.error(`層 ${layer} の件数が ci-summary と違う（JUnit ${got} / ci-summary ${c.total}）`);
  }
}

/** 行ごとの規則。違反なら理由（文字列）を返す。 */
const ROW_RULES = [
  (r) => (STATUSES.includes(r.status) ? null : `status が語彙外（${r.status}）`),
  (r) => (KINDS.includes(r.kind) ? null : `kind が語彙外（${r.kind}）`),
  (r, c) => (c.caseIds.has(r.test_case_id) ? null : "cases.csv に無い TC"),
  (r) => (/^[0-9a-f]{40}$/.test(r.commit_sha) ? null : "commit_sha が 40 桁の SHA でない"),
  (r) => (!done(r) || isIso(r.executed_at) ? null : "executed_at が ISO 8601 でない"),
  (r) => (!done(r) || r.evidence_ids ? null : "証拠 ID が無い"),
  (r) =>
    !pending(r) || (r.reason && r.owner && r.retest_due)
      ? null
      : `${r.status} の reason / owner / retest_due が揃っていない`,
  (r) => (r.environment ? null : "environment が空"),
];

function unresolved(r, ctx) {
  return [
    ...idsIn(r.evidence_ids)
      .filter((id) => !ctx.evidenceIds.has(id))
      .map((id) => `証拠 ${id} が証拠索引に無い`),
    ...idsIn(r.defect_ids)
      .filter((id) => !ctx.defectIds.has(id))
      .map((id) => `不具合 ${id} が defects.csv に無い`),
  ];
}

const rowProblems = (r, ctx) => [
  ...ROW_RULES.map((rule) => rule(r, ctx)).filter(Boolean),
  ...unresolved(r, ctx),
];

/** ctx: { caseIds:Set, evidenceIds:Set, defectIds:Set }。 */
export function checkRows(rows, ctx, report) {
  for (const r of rows) {
    const where = `${r.execution_id ?? "?"} ${r.test_case_id}`;
    for (const problem of rowProblems(r, ctx)) report.error(`${where}: ${problem}`);
    if (r.status === "fail" && !r.defect_ids) report.warn(`${where}: fail の行に defect_ids が無い`);
  }
  const covered = new Set(rows.map((r) => r.test_case_id));
  for (const id of ctx.caseIds) if (!covered.has(id)) report.error(`${id} の実施行が 1 行も無い`);
}
