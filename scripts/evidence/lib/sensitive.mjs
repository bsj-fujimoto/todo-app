// 証跡に秘密情報・個人情報が混ざっていないかの簡易検査（gitleaks 相当の考え方 + メール・トークン形式の正規表現）。純粋関数。
// 注意: 正規表現は不在を証明しない。ここで 0 件でも「無い」とは言えない（最終確認は人。docs/evidence/README.md）。
// 形式は qc-analyzer の find_sensitive と同じ系統（AWS・GitHub・Slack のトークン、password/secret/api_key/token の代入、秘密鍵、メール、電話、カード番号）に、JWT と GitHub の細粒度トークンを足した。
// 電話番号は UUID の一部（0000-4000-8000）に当たらないよう、前後がハイフンのものを除いている。qc-analyzer の元の正規表現にだけ当たるものは
// 「qc 互換の検出」として別に数える（誤検出だが、qc-analyzer の評価では減点になりうる）。

const SECRET_PATTERNS = [
  ["aws-access-key", /AKIA[0-9A-Z]{16}/g],
  ["github-token", /gh[pousr]_[A-Za-z0-9_]{20,}/g],
  ["github-pat", /github_pat_[A-Za-z0-9_]{20,}/g],
  ["slack-token", /xox[baprs]-[A-Za-z0-9-]{20,}/g],
  ["assignment", /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[A-Za-z0-9/+=_-]{8,}/gi],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["jwt", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
];

const PII_PATTERNS = [
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ["phone-jp", /(?<![\d-])0\d{1,4}-\d{1,4}-\d{4}(?![\d-])/g],
  ["card-like", /(?<![\d-])\d{4}-\d{4}-\d{4}-\d{4}(?![\d-])/g],
];

// qc-analyzer（criteria/_common.py の PII_LIKE）の電話・カードの正規表現そのまま。
const QC_COMPAT = [
  ["phone-qc", /(?<!\d)0\d{1,4}-\d{1,4}-\d{4}(?!\d)/g],
  ["card-qc", /(?<!\d)\d{4}-\d{4}-\d{4}-\d{4}(?!\d)/g],
];

/** 値そのものは出さない（先頭 3 文字 + 伏字）。 */
const mask = (value) => `${value.slice(0, 3)}***（${value.length} 文字）`;

function scanLine(line, patterns, kind) {
  return patterns.flatMap(([rule, re]) =>
    [...line.matchAll(re)].map((m) => ({ kind, rule, sample: mask(m[0]) })),
  );
}

/** 1 ファイルの本文を検査。戻り値: [{ line, kind: secret|pii, rule, sample }]。allow は rule 名の配列（許可する検出）。 */
export function scanText(text, allow = []) {
  const found = [];
  text.split("\n").forEach((line, index) => {
    const hits = [...scanLine(line, SECRET_PATTERNS, "secret"), ...scanLine(line, PII_PATTERNS, "pii")];
    for (const h of hits.filter((x) => !allow.includes(x.rule))) found.push({ line: index + 1, ...h });
  });
  return found;
}

/** 許可する検出（既知の誤検出）。パスの正規表現 → 許可する rule。理由は必ず書く。 */
export const ALLOWED = [
  // SBOM（CycloneDX）は第三者パッケージ（alpine・nginx・npm）の公開メタデータを含む。メンテナのメールアドレスは各パッケージが公開している情報で、
  // 利用者データではない。原本の改変は sha256 の保証を壊すので、伏字にせずそのまま残す。
  [/\.cdx\.json$/, ["email"]],
  // CodeQL の SARIF のルール説明（help）に出る例示。example.com の例示アドレス（予約済みドメイン）と、
  // 「password = req.body.password」のような脆弱なコードの説明用サンプル。どちらも実在の個人・秘密情報ではない。
  [/codeql\/javascript\.sarif$/, ["email", "assignment"]],
  // gitleaks の SARIF は、検出した commit の author・メール・メッセージを partialFingerprints に記録する。GitHub の noreply アドレスと
  // Co-Authored-By の noreply で、公開の Git 履歴にある情報。原本の sha256 を保つため伏字にしない。誤検出の allowlist（security/gitleaks.toml）を入れたので、
  // 次回以降の取り込みでは、この種の検出（と commit の記録）は SARIF に出ない。
  [/gitleaks\/gitleaks\.sarif$/, ["email"]],
];

/** files: [{ path, text }]。戻り値: { hits: 失敗にする検出, qcCompat: qc の正規表現にだけ当たる値のファイルごとの件数 }。 */
export function scanFiles(files) {
  const hits = [];
  const qcCompat = new Map();
  for (const { path, text } of files) {
    const allow = ALLOWED.filter(([re]) => re.test(path)).flatMap(([, rules]) => rules);
    hits.push(...scanText(text, allow).map((f) => ({ path, ...f })));
    const extra = text.split("\n").flatMap((line) => scanLine(line, QC_COMPAT, "qc-compat"));
    const strictPii = hits.filter((h) => h.path === path && h.kind === "pii").length;
    if (extra.length > strictPii) qcCompat.set(path, extra.length - strictPii);
  }
  return { hits, qcCompat };
}
