// 1 回の run の実施行（結果がある行 + 結果が無いケースの not_run / skipped 行）を作る。純粋関数。
// 全ケースが少なくとも 1 行ある（無ければ not_run + 理由）。手動ケースは実際に実施していなければ not_run（嘘の pass を作らない）。
import { clipText } from "./observations.mjs";
import {
  actualResultFor,
  combineStatus,
  environmentText,
  executedAtOf,
  groupCases,
  matchEntries,
} from "./executions.mjs";

const refOf = (runId, file, anchor) => `./docs/evidence/runs/${runId}/${file}${anchor ? `#${anchor}` : ""}`;

/** 行の証拠（JUnit の該当ケースと、観察値のファイル）。EV の採番は行を並べ替えた後に行う（build-executions.mjs）。 */
function evidenceEntries(group, entries, ctx) {
  const { runId, sha, runRef, capturedAt } = ctx;
  const source = group.cases[0].source;
  const base = { domain: "execution", captured_at: capturedAt, head_sha: sha };
  const list = [
    {
      ...base,
      claim: `${group.tc} は ${group.label} で ${combineStatus(group.cases)}（${runRef}、JUnit のテスト結果）`,
      ref: refOf(runId, source, group.tc),
      criterion_id: "execution-06",
      type: "junit",
      sha256: ctx.junitShas.get(source) ?? null,
    },
  ];
  for (const file of [...new Set(entries.map((e) => e._file))]) {
    list.push({
      ...base,
      claim: `${group.tc} の ${group.label} での観察値（画面・通信・計測の実測。${runRef}）`,
      ref: refOf(runId, file),
      criterion_id: "execution-05",
      type: "observation",
      sha256: entries.find((e) => e._file === file)._sha,
    });
  }
  return list;
}

function resultRow(group, ctx) {
  const entries = matchEntries(group, ctx.observations);
  const status = combineStatus(group.cases);
  return {
    test_case_id: group.tc,
    kind: ctx.kind,
    run_ref: ctx.runRef,
    commit_sha: ctx.sha,
    environment: environmentText(group.label, entries),
    status,
    actual_result: actualResultFor(group, entries, status),
    evidence_ids: "",
    _evidence: evidenceEntries(group, entries, ctx),
    defect_ids: status === "fail" ? (ctx.defectsByTc.get(group.tc) ?? []).join(";") : "",
    executed_at: executedAtOf(group, entries, ctx.startedAt),
    executor: ctx.executor,
    reason: "",
    owner: "",
    retest_due: "",
    _layer: group.layer,
  };
}

/** 結果が無い行の共通部分（観察値・証拠・実施日時・実施者は空）。 */
const baseRow = (testCase, ctx, fields) => ({
  actual_result: "",
  evidence_ids: "",
  defect_ids: "",
  executed_at: "",
  executor: "",
  reason: "",
  owner: "",
  retest_due: "",
  test_case_id: testCase.test_case_id,
  kind: ctx.kind,
  run_ref: ctx.runRef,
  commit_sha: ctx.sha,
  ...fields,
});

function manualRow(testCase, ctx) {
  const plan = ctx.manual.get(testCase.test_case_id);
  if (!plan) {
    ctx.report.error(
      `手動ケース ${testCase.test_case_id} の実施計画が無い（docs/evidence/manual-plan.yaml）`,
    );
  }
  const { environment = "実機（未指定）", reason = "", owner = "", retest_due = "" } = plan ?? {};
  return baseRow(testCase, ctx, {
    kind: "manual",
    environment,
    status: "not_run",
    actual_result: "未実施のため観察値なし",
    reason,
    owner,
    retest_due,
  });
}

function notSelectedRow(testCase, ctx) {
  const why = (ctx.selection.selection_reason ?? []).join(" / ");
  return baseRow(testCase, ctx, {
    environment: `${testCase.automation_layer}（この run では選ばれていない）`,
    status: "skipped",
    actual_result: "実行していないため観察値なし",
    reason: clipText(`変更影響による選択実行の対象外（${why}）`, 240),
    owner: "QA 担当",
  });
}

function missingRow(testCase, ctx) {
  const gap = ctx.gaps.get(testCase.test_case_id);
  const known = gap ? `。known-gaps の理由: ${gap.reason}` : "";
  return baseRow(testCase, ctx, {
    environment: `${testCase.automation_layer}（この run に結果なし）`,
    status: "not_run",
    actual_result: "実行された記録が無いため観察値なし",
    reason: clipText(`この run の JUnit に ${testCase.test_case_id} の結果が無い${known}`, 240),
    owner: gap?.owner ?? "QA 担当",
    retest_due: gap?.expires_at ?? ctx.retestDue ?? "",
  });
}

function gapRow(testCase, ctx) {
  if (testCase.automation_layer === "manual") return manualRow(testCase, ctx);
  if (
    ctx.selection?.mode === "selected" &&
    !(ctx.selection.selected_case_ids ?? []).includes(testCase.test_case_id)
  ) {
    return notSelectedRow(testCase, ctx);
  }
  return missingRow(testCase, ctx);
}

/** 自動化ケースなのに、その層（automation_layer）での結果が無いものの警告。 */
function layerWarnings(testCases, groups, report) {
  for (const c of testCases) {
    if (c.automation_layer === "manual") continue;
    const layers = groups.filter((g) => g.tc === c.test_case_id).map((g) => g.layer);
    const accepted = c.automation_layer === "e2e" ? ["e2e", "compose"] : [c.automation_layer];
    if (layers.length > 0 && !layers.some((l) => accepted.includes(l))) {
      report.warn(
        `${c.test_case_id} は ${c.automation_layer} 層の自動化ケースだが、結果は ${layers.join("/")} 層のみ`,
      );
    }
  }
}

/** ctx: { testCases, junitCases, junitShas, observations, runId, runRef, sha, kind, executor, startedAt, capturedAt,
 *         selection, manual, gaps, defectsByTc, retestDue, evidence(entry)→EV, report } */
export function buildRunRows(ctx) {
  const groups = groupCases(ctx.junitCases);
  const known = new Set(ctx.testCases.map((c) => c.test_case_id));
  for (const g of groups.filter((x) => !known.has(x.tc)))
    ctx.report.error(`cases.csv に無い TC-ID の結果: ${g.tc}`);
  const rows = groups.filter((g) => known.has(g.tc)).map((g) => resultRow(g, ctx));
  const covered = new Set(rows.map((r) => r.test_case_id));
  const gaps = ctx.testCases.filter((c) => !covered.has(c.test_case_id)).map((c) => gapRow(c, ctx));
  layerWarnings(ctx.testCases, groups, ctx.report);
  return [...rows, ...gaps];
}
