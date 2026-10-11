// REQ → RISK → VIEW → TC → EXEC → DEF → FND → ACT の接続（docs/data/traceability.csv）を、各表から組み立てる。純粋関数。
// 1 行 = 1 ケース（その要求・リスク・観点・実施・不具合・検出・アクション）。ケースに結び付かない要求・リスク・観点・検出・アクションは、
// 空欄ではなく「gaps」付きの行にして残す（欠落を隠さない）。複数値は ; 区切り。
import { idsIn, uniq } from "./common.mjs";

export const TRACE_COLUMNS = [
  "trace_id",
  "requirement_ids",
  "risk_ids",
  "perspective_ids",
  "test_case_id",
  "execution_ids",
  "defect_ids",
  "finding_ids",
  "action_ids",
  "gaps",
];

const empty = {
  requirement_ids: "",
  risk_ids: "",
  perspective_ids: "",
  test_case_id: "",
  execution_ids: "",
  defect_ids: "",
  finding_ids: "",
  action_ids: "",
  gaps: "",
};
const mentions = (text, prefix) => uniq(String(text).match(new RegExp(`${prefix}-\\d+`, "g")) ?? []);
const join = (list) => uniq(list).join(";");

/** アクションが指すケース（what に書かれた TC と、書かれた DEF の関連ケース）と、その検出。 */
function actionLinks(actions, defects) {
  const caseIdsOf = new Map(defects.map((d) => [d.defect_id, idsIn(d.case_ids)]));
  return actions.map((a) => ({
    id: a.action_id,
    cases: uniq([
      ...mentions(a.what, "TC"),
      ...mentions(a.what, "DEF").flatMap((d) => caseIdsOf.get(d) ?? []),
    ]),
    findings: idsIn(a.finding_ids),
    defects: mentions(a.what, "DEF"),
  }));
}

function chainRow(c, ctx) {
  const defects = ctx.defects.filter((d) => idsIn(d.case_ids).includes(c.test_case_id));
  const linked = ctx.links.filter((l) => l.cases.includes(c.test_case_id));
  const execs = ctx.executions.filter((e) => e.test_case_id === c.test_case_id);
  const gaps = [];
  if (execs.length === 0) gaps.push("実施行なし");
  else if (execs.every((e) => e.status !== "pass")) gaps.push("pass の実施行なし");
  return {
    ...empty,
    requirement_ids: join(idsIn(c.requirement_ids)),
    risk_ids: join(idsIn(c.risk_ids)),
    perspective_ids: join(idsIn(c.perspective_ids)),
    test_case_id: c.test_case_id,
    execution_ids: join(execs.map((e) => e.execution_id)),
    defect_ids: join(defects.map((d) => d.defect_id)),
    finding_ids: join(linked.flatMap((l) => l.findings)),
    action_ids: join(linked.map((l) => l.id)),
    gaps: gaps.join(" / "),
  };
}

/** ケース・検出・アクションが結び付かない欠落の行。 */
function gapRows(ctx) {
  const used = (col) => new Set(ctx.cases.flatMap((c) => idsIn(c[col])));
  const [reqs, risks, views] = ["requirement_ids", "risk_ids", "perspective_ids"].map(used);
  const linkedFindings = new Set(ctx.links.flatMap((l) => l.findings));
  const linkedActions = new Set(
    ctx.links.filter((l) => l.cases.length + l.findings.length + l.defects.length > 0).map((l) => l.id),
  );
  return [
    ...ctx.requirements
      .filter((r) => !reqs.has(r.id))
      .map((r) => ({ requirement_ids: r.id, gaps: "対応するケースがない" })),
    ...ctx.risks
      .filter((r) => !risks.has(r.id))
      .map((r) => ({ risk_ids: r.id, gaps: "対応するケースがない" })),
    ...ctx.perspectives
      .filter((p) => p.applicability === "applicable" && !views.has(p.perspective_id))
      .map((p) => ({ perspective_ids: p.perspective_id, gaps: "適用の観点にケースがない" })),
    ...ctx.defects
      .filter((d) => idsIn(d.case_ids).length === 0)
      .map((d) => ({
        defect_ids: d.defect_id,
        action_ids: join(ctx.links.filter((l) => l.defects.includes(d.defect_id)).map((l) => l.id)),
        gaps: `関連ケースがない（検出した手段: ${d.detected_phase}）`,
      })),
    ...ctx.findings
      .filter((f) => ["tp", "accepted", "untriaged"].includes(f.status) && !linkedFindings.has(f.finding_id))
      .map((f) => ({
        finding_ids: f.finding_id,
        gaps: `未是正の検出（${f.status}）に対応するアクションがない`,
      })),
    ...ctx.actions
      .filter((a) => !linkedActions.has(a.action_id))
      .map((a) => ({ action_ids: a.action_id, gaps: "ケース・検出・不具合に結び付かないアクション" })),
  ];
}

/** 検出 → アクションの接続の行。 */
function findingRows(ctx) {
  const linked = new Set(ctx.links.flatMap((l) => l.findings));
  return ctx.findings
    .filter((f) => linked.has(f.finding_id))
    .map((f) => ({
      finding_ids: f.finding_id,
      action_ids: join(ctx.links.filter((l) => l.findings.includes(f.finding_id)).map((l) => l.id)),
    }));
}

const orphanRows = (ctx) => [...gapRows(ctx), ...findingRows(ctx)];

/** ctx: 各表の行 { cases, requirements, risks, perspectives, executions, defects, actions, findings }。 */
export function buildTraceability(tables) {
  const ctx = { ...tables, links: actionLinks(tables.actions, tables.defects) };
  const rows = [
    ...ctx.cases.map((c) => chainRow(c, ctx)),
    ...orphanRows(ctx).map((r) => ({ ...empty, ...r })),
  ];
  return rows.map((r, i) => ({ ...r, trace_id: `TR-${String(i + 1).padStart(3, "0")}` }));
}

/** 追跡の集計（README・PR 本文用）。 */
export function summarize(rows, tables) {
  const covered = (col) => new Set(rows.filter((r) => r.test_case_id).flatMap((r) => idsIn(r[col])));
  return {
    cases: rows.filter((r) => r.test_case_id).length,
    requirements: `${covered("requirement_ids").size}/${tables.requirements.length}`,
    risks: `${covered("risk_ids").size}/${tables.risks.length}`,
    gaps: rows.filter((r) => r.gaps).length,
  };
}
