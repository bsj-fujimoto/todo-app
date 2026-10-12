// 「どの時点の台帳を適用した検出か」の記録（findings.json の ledgers_applied）。
// 生の検査出力（SARIF など）は検査したときのまま、台帳（triage・受容・安定 ID）を適用した findings.json は台帳が変わると結果も変わる。
// 後から証跡を読む人が、その findings.json にどの台帳（内容の sha256・件数・対象 commit）を適用したかを辿れるようにする。
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";

export const APPLIED_LEDGERS = [
  ["triage", "security/triage.yaml", "entries"],
  ["accepted_risks", "security/accepted-risks.yaml", "entries"],
  ["finding_ids", "security/finding-ids.yaml", "ids"],
  ["expected_scans", "security/expected-scans.yaml", "scans"],
];

function recordOf(root, path, listKey) {
  const file = join(root, path);
  if (!existsSync(file)) return { path, exists: false, sha256: null, entries: 0 };
  const text = readFileSync(file);
  const doc = parseYaml(text.toString("utf8")) ?? {};
  return {
    path,
    exists: true,
    sha256: createHash("sha256").update(text).digest("hex"),
    entries: (doc[listKey] ?? []).length,
  };
}

/** findings.json に入れる記録。commit は台帳ファイルを読んだ時点の対象 commit（CI は checkout した TARGET_SHA）。 */
export function ledgersApplied(root, { commit, appliedAt }) {
  return {
    applied_at: appliedAt,
    ledger_commit: commit ?? null,
    note: "findings.json は、この台帳（内容の sha256）を生の検査出力に適用した結果。台帳が変わると同じ検出の状態（untriaged / fp / accepted など）も変わるので、取り込んだ時点の台帳をここで特定する",
    ledgers: Object.fromEntries(
      APPLIED_LEDGERS.map(([key, path, listKey]) => [key, recordOf(root, path, listKey)]),
    ),
  };
}
