// セキュリティ検出（triage の findings.json）→ docs/data/findings.csv。FND-nnn の ID を docs/data の中で定義する
// （実施表・不具合表・アクション表・追跡表が FND を参照しても、docs-check の ID 解決が通るように）。純粋関数。
import { clipText } from "./observations.mjs";
import { toFndId } from "./findings.mjs";

export const FINDING_COLUMNS = [
  "finding_id",
  "source_finding_id",
  "severity",
  "status",
  "tool",
  "scan",
  "category",
  "rule_id",
  "component",
  "location",
  "title",
  "owner",
  "due",
  "issue",
  "ledger_ref",
  "fingerprint",
  "trend",
  "run_url",
  "head_sha",
];

const text = (value) => (value === null || value === undefined ? "" : String(value));

/** findings.json（triage の出力）→ 表の行。finding_id は triage が fingerprint から決めた安定 ID（FND-nnn。台帳 security/finding-ids.yaml）。旧形式 F-001 は FND-001 に写す。 */
export function findingRows(doc) {
  const unregistered = (doc?.findings ?? []).filter((f) => !toFndId(f.finding_id));
  if (unregistered.length) {
    throw new Error(
      `安定 ID（FND-nnn）が未登録の検出が ${unregistered.length} 件ある（${unregistered.map((f) => f.finding_id).join(", ")}）。` +
        "node scripts/security/assign-finding-ids.mjs --findings <findings.json> --write で security/finding-ids.yaml に振って commit してから、triage を再実行する",
    );
  }
  return (doc?.findings ?? []).map((f) => ({
    finding_id: toFndId(f.finding_id),
    source_finding_id: f.finding_id,
    severity: f.severity,
    status: f.status,
    tool: f.tool,
    scan: text(f.scan),
    category: text(f.category),
    rule_id: text(f.rule_id),
    component: text(f.component),
    location: text(f.location),
    title: clipText(text(f.title).replace(/\s+/g, " "), 120),
    owner: text(f.owner),
    due: text(f.due ?? f.expires_at),
    issue: text(f.issue),
    ledger_ref: text(f.accepted_by ?? f.ledger),
    fingerprint: text(f.fingerprint),
    trend: text(f.trend),
    run_url: text(doc.run_url),
    head_sha: text(doc.target?.commit_sha),
  }));
}
