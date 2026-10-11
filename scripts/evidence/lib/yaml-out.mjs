// 決定的な YAML 書き出し（マップ・リスト・スカラーだけ。アンカーやタグは使わない）。
// 日付に見える文字列（2026-10-11）や、数字で始まる・予約語の文字列は引用符で包み、YAML の読み手が型を変えないようにする。
const PLAIN = /^[A-Za-z][A-Za-z0-9_./-]*$/;
const RESERVED = new Set(["true", "false", "null", "yes", "no", "on", "off", "y", "n"]);

export function scalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  return PLAIN.test(text) && !RESERVED.has(text.toLowerCase()) ? text : JSON.stringify(text);
}

const isBlock = (v) =>
  v !== null && typeof v === "object" && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);
const flowEmpty = (v) => (Array.isArray(v) ? "[]" : "{}");

function mapLines(obj, indent) {
  const pad = " ".repeat(indent);
  return Object.entries(obj).flatMap(([key, v]) => {
    if (v !== null && typeof v === "object" && !isBlock(v)) return [`${pad}${key}: ${flowEmpty(v)}`];
    if (!isBlock(v)) return [`${pad}${key}: ${scalar(v)}`];
    return [`${pad}${key}:`, ...lines(v, indent + 2)];
  });
}

function listLines(list, indent) {
  const pad = " ".repeat(indent);
  return list.flatMap((item) => {
    if (!isBlock(item))
      return [`${pad}- ${item !== null && typeof item === "object" ? flowEmpty(item) : scalar(item)}`];
    const inner = lines(item, indent + 2);
    return [`${pad}- ${inner[0].trimStart()}`, ...inner.slice(1)];
  });
}

function lines(value, indent) {
  return Array.isArray(value) ? listLines(value, indent) : mapLines(value, indent);
}

/** 先頭にコメント行（# 付き）を足して YAML 文字列にする。 */
export function toYaml(value, comments = []) {
  const head = comments.map((c) => `# ${c}`);
  return `${[...head, ...lines(value, 0)].join("\n")}\n`;
}
