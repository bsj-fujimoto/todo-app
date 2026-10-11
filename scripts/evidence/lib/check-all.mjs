// check-evidence.mjs の各検査。どれも { id, title, status: pass|fail|skipped, messages[], warnings[], stats } を返す。
// データの読み込み（ファイル入出力）は呼び出し側。ここは読み込んだ表・文書・ファイルに対する検査。
import { toCsv } from "../../ci/lib/csv.mjs";
import { createReport, idsIn } from "./common.mjs";
import { TRACE_COLUMNS, buildTraceability } from "./traceability.mjs";
import { checkDefectRows } from "./defects.mjs";
import { checkActions } from "./actions.mjs";
import { checkActualResults, checkRows, checkSingleVersion } from "./execution-checks.mjs";
import { checkReferences } from "./id-check.mjs";
import { checkParity } from "./parity.mjs";
import { scanFiles } from "./sensitive.mjs";

const result = (id, title, report, stats = {}) => ({
  id,
  title,
  status: report.ok ? "pass" : "fail",
  messages: report.errors,
  warnings: report.warnings,
  stats,
});

export function idReferences(bundle) {
  const report = createReport();
  const { defined, references, unresolved } = checkReferences(bundle.tables);
  for (const u of unresolved) report.error(`未解決: ${u.id}（${u.where}）`);
  return result(
    "id-references",
    "docs/data の ID 参照がすべて解決する（REQ/RISK/VIEW/TC/UNK/DS/EXEC/DEF/FND/ACT/EV）",
    report,
    {
      defined: defined.size,
      references,
      unresolved: unresolved.length,
    },
  );
}

export function parity(bundle) {
  const report = createReport();
  const { checked, problems } = checkParity(bundle.docs, bundle.tables);
  for (const p of problems) report.error(p);
  return result("parity", "表（CSV）と md の件数・列が一致する（抽出パリティ）", report, { checked });
}

export function executions(bundle, opts) {
  const report = createReport();
  const rows = bundle.tables.executions?.rows ?? [];
  const cases = bundle.tables.cases.rows;
  const ctx = {
    caseIds: new Set(cases.map((c) => c.test_case_id)),
    evidenceIds: new Set(bundle.tables["evidence-index"].rows.map((r) => r.evidence_id)),
    defectIds: new Set(bundle.tables.defects.rows.map((d) => d.defect_id)),
  };
  checkRows(rows, ctx, report);
  checkActualResults(rows, cases, report);
  if (!opts.allowMixedVersions) checkSingleVersion(rows, report, opts.release);
  const observed = new Set(
    bundle.tables["evidence-index"].rows.filter((r) => r.type === "observation").map((r) => r.evidence_id),
  );
  const passRows = rows.filter((r) => r.status === "pass");
  const withObservation = passRows.filter((r) => idsIn(r.evidence_ids).some((id) => observed.has(id)));
  const stats = { rows: rows.length, pass: passRows.length, with_observation: withObservation.length };
  for (const d of bundle.tables.defects.rows.filter((x) => x.status === "fixed")) {
    const verified = idsIn(d.case_ids).some((tc) =>
      rows.some((r) => r.test_case_id === tc && r.status === "pass"),
    );
    if (!verified)
      report.warn(`${d.defect_id}: fixed だが、関連ケースに pass の実施行が無い（修正確認の記録なし）`);
  }
  return result(
    "executions",
    "実施表: 語彙・版の単一性・実測値・証拠・未実施の理由と owner・全ケースの行",
    report,
    stats,
  );
}

export function defects(bundle) {
  const report = createReport();
  const rows = bundle.tables.defects.rows;
  checkDefectRows(rows, report);
  const caseIds = new Set(bundle.tables.cases.rows.map((c) => c.test_case_id));
  const evidenceIds = new Set(bundle.tables["evidence-index"].rows.map((r) => r.evidence_id));
  for (const d of rows) {
    for (const tc of idsIn(d.case_ids))
      if (!caseIds.has(tc)) report.error(`${d.defect_id}: case_ids の ${tc} が cases.csv に無い`);
    for (const ev of idsIn(d.evidence_ids))
      if (!evidenceIds.has(ev)) report.error(`${d.defect_id}: evidence_ids の ${ev} が索引に無い`);
  }
  return result(
    "defects",
    "不具合表: 語彙・原因分類・case_ids / evidence_ids の解決・fixed の fix_commit",
    report,
    { rows: rows.length },
  );
}

export function actions(bundle) {
  const report = createReport();
  const findingIds = new Set(bundle.tables.findings?.rows.map((r) => r.finding_id) ?? []);
  checkActions(bundle.tables.actions.rows, findingIds, report);
  return result("actions", "アクション表: 様式・語彙・日付・finding_ids の解決", report, {
    rows: bundle.tables.actions.rows.length,
  });
}

const TRACE_TABLES = [
  "requirements",
  "risks",
  "perspectives",
  "cases",
  "executions",
  "defects",
  "findings",
  "actions",
];
const gapSubject = (r) =>
  r.test_case_id || r.requirement_ids || r.risk_ids || r.perspective_ids || r.finding_ids || r.action_ids;

/** 追跡表が元の表から生成した結果と一致するか（currentCsv: いまのファイルの本文。無ければ null）。gaps は警告。 */
export function traceability(bundle, currentCsv) {
  const report = createReport();
  const tables = Object.fromEntries(TRACE_TABLES.map((n) => [n, bundle.tables[n]?.rows ?? []]));
  const rows = buildTraceability(tables);
  if (currentCsv !== toCsv(TRACE_COLUMNS, rows)) {
    report.error(
      "traceability.csv が元の表から生成した結果と一致しない（build-traceability.mjs で再生成する）",
    );
  }
  for (const r of rows.filter((x) => x.gaps)) report.warn(`${r.trace_id} ${gapSubject(r)}: ${r.gaps}`);
  return result("traceability", "追跡表（REQ→RISK→VIEW→TC→EXEC→DEF→FND→ACT）が元の表と一致する", report, {
    rows: rows.length,
  });
}

/** 成果物台帳が古いとき: 既定は警告。失敗にするのは strictArtifacts（--strict-artifacts）のときだけ。 */
export function artifactsResult({ stale, strictArtifacts, message }) {
  const failed = stale && strictArtifacts;
  return {
    id: "artifacts",
    title: "成果物台帳・正本の所在地が文書の現状と一致する",
    status: failed ? "fail" : "pass",
    messages: failed ? [message] : [],
    warnings: stale && !failed ? [message] : [],
    stats: { strict_artifacts: strictArtifacts },
  };
}

export function sensitive(bundle) {
  const report = createReport();
  const { hits, qcCompat } = scanFiles(bundle.textFiles, { owners: bundle.owners ?? [] });
  for (const h of hits) report.error(`${h.kind}（${h.rule}）らしい値: ${h.path}:${h.line} ${h.sample}`);
  for (const [path, n] of qcCompat) {
    report.warn(
      `${path}: qc-analyzer の電話番号・カード番号の正規表現に当たる値が ${n} 件（UUID の 0 の並びなど。実際の個人情報ではないが、qc の評価では減点になりうる）`,
    );
  }
  report.warn("正規表現は不在を証明しない。0 件でも秘密情報・個人情報が無いとは言えない（最終確認は人）");
  return result("sensitive", "証跡に秘密情報・個人情報らしい値が無い（簡易検査）", report, {
    files: bundle.textFiles.length,
    hits: hits.length,
  });
}

export const summarizeChecks = (checks) => ({
  result: checks.some((c) => c.status === "fail") ? "fail" : "pass",
  failed: checks.filter((c) => c.status === "fail").map((c) => c.id),
});
