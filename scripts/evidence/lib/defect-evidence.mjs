// 不具合の証拠（EV）: 起票内容（Issue のスナップショット）と、修正済みなら修正確認（関連ケースの pass 実施行の JUnit 証拠）。
import { idsIn } from "./common.mjs";
import { defectId } from "./defects.mjs";

/** fields: extractFields の結果 + status。executions: executions.csv の行。 */
export function issueEvidence({ issue, fields, registry, executions, snapshotSha, source }) {
  const n = issue.number;
  const ids = [
    registry.allocate({
      claim: `${defectId(n)} の起票内容（GitHub Issue #${n}。再現・期待・実際・影響・原因分類）`,
      ref: `./docs/evidence/github/defect-issues.json#issue-${n}`,
      domain: "execution",
      criterion_id: "execution-07",
      type: "issue",
      sha256: snapshotSha,
      captured_at: source.captured_at,
      head_sha: source.head_sha,
    }),
  ];
  if (fields.status === "fixed") ids.push(...verification(fields.case_ids, registry, executions));
  return ids;
}

/** 関連ケースごとに、pass の実施行が持つ JUnit 証拠を 1 つ。 */
function verification(caseIds, registry, executions) {
  const out = [];
  for (const tc of caseIds) {
    const passed = executions.filter((r) => r.test_case_id === tc && r.status === "pass");
    const junit = passed
      .flatMap((r) => idsIn(r.evidence_ids))
      .find((id) => registry.get(id)?.type === "junit");
    if (junit) out.push(junit);
  }
  return [...new Set(out)];
}
