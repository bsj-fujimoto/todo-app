// 取り込む証跡の墨消し（人の氏名・メール・アカウント名・秘密情報らしい値を、決定的に [REDACTED:…] へ置き換える）。純粋関数。
// 同じ入力は同じ出力になる。置き換えが 1 件も無いファイルは、本文をそのまま（バイト単位で同じに）返す。
// JSON / SARIF は構造として読み、個人情報のキー（redact-rules.mjs の PERSON_KEYS）の値と、メールアドレス形式・Co-Authored-By 等の氏名・
// 秘密情報の形式・アカウントのメンション・リポジトリのオーナー名（URL 以外）を文字列の中から置き換える。ほかの形式は文字列として置き換える。
// 記録: 何をなぜ置き換えたか（規則ごとの件数）、元ファイルと墨消し後の sha256 は fetch-run.mjs が SOURCE.json に残す。
import { isEmailKey, PERSON_KEYS } from "./redact-rules.mjs";
import { EMAIL, MENTION, SECRET_PATTERNS, ownerPattern } from "./sensitive.mjs";

const TRAILER = /^(\s*(?:Co-Authored-By|Signed-off-by|Reviewed-by|Acked-by)\s*:\s*)(.+?)(\s*<)/gim;
export const REDACTION_REASON =
  "人の氏名・メールアドレス・アカウント名・秘密情報らしい値を証跡に残さない方針（docs/evidence/README.md）";

/** 「氏名 <メール>」（CycloneDX の author の書き方など）の氏名。Co-Authored-By などの見出し（: を含む）は TRAILER が先に扱う。 */
const NAME_EMAIL = /(^|[,;]\s*)([^<>,;:[\]\n]+?)\s*<(?=[^<>\s]+@[^<>\s]+>)/gm;

const bump = (counts, rule, n = 1) => counts.set(rule, (counts.get(rule) ?? 0) + n);

/** 文字列の中の個人情報・秘密情報らしい値を置き換える。counts（rule → 件数）に数える。 */
export function scrubString(text, counts, owners = []) {
  let out = text.replace(TRAILER, (_, head, _name, tail) => {
    bump(counts, "trailer-name");
    return `${head}[REDACTED:author]${tail}`;
  });
  out = out.replace(NAME_EMAIL, (_, lead) => {
    bump(counts, "name-email");
    return `${lead}[REDACTED:author] <`;
  });
  const rules = [
    ...SECRET_PATTERNS.map(([rule, re]) => [rule, re, "[REDACTED:secret]"]),
    [EMAIL[0], EMAIL[1], "[REDACTED:email]"],
    [MENTION[0], MENTION[1], "[REDACTED:account]"],
    ...owners.map((o) => {
      const [rule, re] = ownerPattern(o);
      return [rule, re, "[REDACTED:account]"];
    }),
  ];
  for (const [rule, re, mark] of rules) {
    out = out.replace(re, () => {
      bump(counts, rule);
      return mark;
    });
  }
  return out;
}

function walk(value, counts, owners, key = "") {
  // CycloneDX の group は npm のスコープ（@fastify など）で、アカウントのメンションではない
  if (typeof value === "string") return key === "group" ? value : scrubString(value, counts, owners);
  if (Array.isArray(value)) return value.map((v) => walk(v, counts, owners, key));
  if (value === null || typeof value !== "object") return value;
  const hasEmail = typeof value.email === "string";
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => {
      const person = typeof v === "string" && (PERSON_KEYS.has(k) || (k === "name" && hasEmail));
      if (!person) return [k, walk(v, counts, owners, k)];
      bump(counts, `key:${k}`);
      return [k, isEmailKey(k) ? "[REDACTED:email]" : "[REDACTED:author]"];
    }),
  );
}

const indentOf = (text) => /^\n?( +)"/m.exec(text)?.[1].length ?? 2;

function redactJson(text, counts, owners) {
  const doc = JSON.parse(text);
  const out = JSON.stringify(walk(doc, counts, owners), null, indentOf(text));
  return text.endsWith("\n") ? `${out}\n` : out;
}

function redactJsonLines(text, counts, owners) {
  return text
    .split("\n")
    .map((line) => {
      if (!line.trim()) return line;
      try {
        return JSON.stringify(walk(JSON.parse(line), counts, owners));
      } catch {
        return scrubString(line, counts, owners);
      }
    })
    .join("\n");
}

/** ファイルの形式（拡張子）に応じて墨消しする。戻り値: { text, counts: [{ rule, count }], changed }。 */
export function redactText(text, path, owners = []) {
  const counts = new Map();
  let out;
  if (/\.(json|sarif)$/.test(path)) {
    try {
      out = redactJson(text, counts, owners);
    } catch {
      out = scrubString(text, counts, owners);
    }
  } else if (/\.jsonl$/.test(path)) out = redactJsonLines(text, counts, owners);
  else out = scrubString(text, counts, owners);
  const changed = counts.size > 0 && out !== text;
  return {
    text: changed ? out : text,
    changed,
    counts: [...counts]
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => a.rule.localeCompare(b.rule)),
  };
}
