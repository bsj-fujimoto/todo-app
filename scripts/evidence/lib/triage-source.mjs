// security 証跡の SOURCE.json に書く「台帳を適用した検出（triaged）」の記録。純粋関数。
// 生の検査出力（security-scan-*/ の SARIF・JSON）と、台帳（triage・受容・安定 ID）を適用した findings.json は別物。
// 後者は台帳が変わると結果が変わるので、どの時点の台帳を適用したか（findings.json の ledgers_applied）をここに写す。
const pick = (doc, ...keys) => keys.reduce((o, k) => o?.[k], doc) ?? null;

export const triageSource = (doc) => ({
  triage: {
    findings_file: "security-findings/findings.json",
    kind: "triaged（台帳を適用した検出。生の検査出力は security-scan-*/ の SARIF・JSON）",
    generated_at: pick(doc, "generated_at"),
    target_commit: pick(doc, "target", "commit_sha"),
    gate: pick(doc, "gate", "result"),
    summary: pick(doc, "summary", "by_status"),
    ledgers_applied: pick(doc, "ledgers_applied"),
  },
});
