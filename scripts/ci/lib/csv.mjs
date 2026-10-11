// RFC 4180 の CSV（引用符・引用符内の改行・"" エスケープ）を依存ゼロで読み書きする。

function endRow(s) {
  s.row.push(s.cell);
  s.rows.push(s.row);
  s.row = [];
  s.cell = "";
}

// 引用符の中。戻り値は「先読みで消費した文字数」。
function stepQuoted(s, c, next) {
  if (c !== '"') {
    s.cell += c;
    return 0;
  }
  if (next === '"') {
    s.cell += '"';
    return 1;
  }
  s.inQuotes = false;
  return 0;
}

function stepPlain(s, c, next) {
  if (c === '"') s.inQuotes = true;
  else if (c === ",") {
    s.row.push(s.cell);
    s.cell = "";
  } else if (c === "\n" || c === "\r") {
    endRow(s);
    return c === "\r" && next === "\n" ? 1 : 0;
  } else s.cell += c;
  return 0;
}

export function parseCsv(text) {
  const s = { rows: [], row: [], cell: "", inQuotes: false };
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) i += (s.inQuotes ? stepQuoted : stepPlain)(s, src[i], src[i + 1]);
  if (s.cell !== "" || s.row.length > 0) endRow(s);
  return s.rows;
}

/** ヘッダ行つき CSV → オブジェクト配列。空行は捨てる。 */
export function parseCsvObjects(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) return { header: [], rows: [] };
  const rows = body
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
  return { header, rows };
}

const needsQuote = /[",\r\n]/;
const quote = (v) => (needsQuote.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));

export function toCsv(header, rows) {
  const lines = [header.join(","), ...rows.map((r) => header.map((h) => quote(r[h] ?? "")).join(","))];
  return `${lines.join("\n")}\n`;
}
