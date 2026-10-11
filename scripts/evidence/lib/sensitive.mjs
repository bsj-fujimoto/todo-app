// 証跡に秘密情報・個人情報が混ざっていないかの簡易検査（gitleaks 相当の考え方 + メール・トークン形式の正規表現 + 個人情報のキー）。純粋関数。
// **許可リストの例外は作らない**。見つかったら、取り込み時の墨消し（redact.mjs。fetch-run.mjs が行う）で取り除く。
// 注意: 正規表現は不在を証明しない。ここで 0 件でも「無い」とは言えない（最終確認は人。docs/evidence/README.md）。
// 形式は qc-analyzer の find_sensitive と同じ系統（AWS・GitHub・Slack のトークン、password/secret/api_key/token の代入、秘密鍵、メール、電話、カード番号）に、
// JWT・GitHub の細粒度トークン・アカウントのメンション（@name）・リポジトリのオーナー名（URL 以外）・git の author 名を持つキーを足した。
// 電話番号は UUID の一部（0000-4000-8000）に当たらないよう、前後がハイフンのものを除いている。qc-analyzer の元の正規表現にだけ当たるものは
// 「qc 互換の検出」として別に数える（誤検出だが、qc-analyzer の評価では減点になりうる）。
import { PERSON_KEYS } from "./redact-rules.mjs";

export const SECRET_PATTERNS = [
  ["aws-access-key", /AKIA[0-9A-Z]{16}/g],
  ["github-token", /gh[pousr]_[A-Za-z0-9_]{20,}/g],
  ["github-pat", /github_pat_[A-Za-z0-9_]{20,}/g],
  ["slack-token", /xox[baprs]-[A-Za-z0-9-]{20,}/g],
  ["assignment", /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[A-Za-z0-9/+=_-]{8,}/gi],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["jwt", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
];

export const EMAIL = ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g];
/** アカウントのメンション（@name）。npm のスコープ（@scope/pkg。CycloneDX の "group": "@scope" も）・JSON のキー（ZAP の "@version": など。名前の直後が引用符とコロン）・パッケージの版（pkg@1.0）・メールの一部は除く。 */
export const MENTION = [
  "mention",
  /(?<![\w@./-])(?<!"group":\s?")@[A-Za-z][A-Za-z0-9-]{2,38}(?![A-Za-z0-9/-])(?!"\s*:)/g,
];

const PII_PATTERNS = [
  EMAIL,
  MENTION,
  ["phone-jp", /(?<![\d-])0\d{1,4}-\d{1,4}-\d{4}(?![\d-])/g],
  ["card-like", /(?<![\d-])\d{4}-\d{4}-\d{4}-\d{4}(?![\d-])/g],
];

// qc-analyzer（criteria/_common.py の PII_LIKE）の電話・カードの正規表現そのまま。
const QC_COMPAT = [
  ["phone-qc", /(?<!\d)0\d{1,4}-\d{1,4}-\d{4}(?!\d)/g],
  ["card-qc", /(?<!\d)\d{4}-\d{4}-\d{4}-\d{4}(?!\d)/g],
];

/** 値そのものは出さない（先頭の文字も出さない。位置は path:line で分かる）。 */
const mask = (value) => `***（${value.length} 文字）`;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** リポジトリのオーナー名が、URL・owner/repo の形（後ろが /）以外で書かれている箇所。人名・アカウント名として書かれたものを拾う。 */
export const ownerPattern = (owner) => [
  "owner-name",
  new RegExp(`(?<!github\\.com/|ghcr\\.io/)(?<![\\w-])${escapeRe(owner)}(?![\\w-]|/)`, "g"),
];

function scanLine(line, patterns, kind) {
  return patterns.flatMap(([rule, re]) =>
    [...line.matchAll(re)].map((m) => ({ kind, rule, sample: mask(m[0]) })),
  );
}

/** 1 ファイルの本文を検査。戻り値: [{ line, kind: secret|pii, rule, sample }]。owners: リポジトリのオーナー名の配列。 */
export function scanText(text, { owners = [] } = {}) {
  const found = [];
  const pii = [...PII_PATTERNS, ...owners.map(ownerPattern)];
  text.split("\n").forEach((line, index) => {
    const hits = [...scanLine(line, SECRET_PATTERNS, "secret"), ...scanLine(line, pii, "pii")];
    for (const h of hits) found.push({ line: index + 1, ...h });
  });
  return found;
}

/** 人の氏名・メールを持つキー（author・committer・email…）が、墨消し済み（[REDACTED:…]）でない値を持つ JSON を拾う。 */
export function personalKeyHits(text, path) {
  if (!/\.(json|sarif)$/.test(path)) return [];
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const hits = [];
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (PERSON_KEYS.has(k) && typeof v === "string" && !v.startsWith("[REDACTED:")) {
          const line =
            text
              .split("\n")
              .findIndex((l) => l.includes(`"${k}"`) && l.includes(JSON.stringify(v).slice(1, -1))) + 1;
          hits.push({ line, kind: "pii", rule: `personal-key:${k}`, sample: mask(v) });
        } else walk(v);
      }
    }
  };
  walk(doc);
  return hits;
}

/** files: [{ path, text }]。戻り値: { hits: 失敗にする検出, qcCompat: qc の正規表現にだけ当たる値のファイルごとの件数 }。 */
export function scanFiles(files, options = {}) {
  const hits = [];
  const qcCompat = new Map();
  for (const { path, text } of files) {
    const found = [...scanText(text, options), ...personalKeyHits(text, path)];
    hits.push(...found.map((f) => ({ path, ...f })));
    const extra = text.split("\n").flatMap((line) => scanLine(line, QC_COMPAT, "qc-compat"));
    const strictPii = found.filter((h) => ["phone-jp", "card-like"].includes(h.rule)).length;
    if (extra.length > strictPii) qcCompat.set(path, extra.length - strictPii);
  }
  return { hits, qcCompat };
}
