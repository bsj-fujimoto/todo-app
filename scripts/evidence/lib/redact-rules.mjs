// 墨消し（redact.mjs）と検査（sensitive.mjs）が共有する、個人情報を持つキーの一覧。
/**
 * 人の氏名・メールアドレスを値に持つキー（gitleaks の SARIF の partialFingerprints、CycloneDX の author、git の author / committer など）。
 * 値が文字列のとき墨消しする。email 系は [REDACTED:email]、それ以外は [REDACTED:author]。
 */
export const PERSON_KEYS = new Set([
  "author",
  "authorName",
  "committer",
  "committerName",
  "email",
  "authorEmail",
  "committerEmail",
]);

export const isEmailKey = (key) => key === "email" || key.endsWith("Email");
