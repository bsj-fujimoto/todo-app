// 依存ゼロの YAML サブセットパーサ。
// 対象: quality/*.yaml・security/*.yaml など「人が書く台帳」の形だけ。
//   - ブロックのマップ / リスト（リストの要素がマップでもよい）
//   - スカラー（plain / 'single' / "double"）、数値、true / false / null
//   - フロー形式の短いリスト・空マップ（[a, b] / {}）
//   - ブロックスカラー（| 改行保持、> 折りたたみ）
//   - 行コメント（# の前が空白、または行頭）
// 対象外（書いたら明示的にエラーにする）: アンカー・エイリアス・タグ・複数ドキュメント・複雑なフロー。
// 日付（2026-10-11）は Date にせず文字列のまま返す。

export class YamlLiteError extends Error {}

const BLOCK_SCALAR = /^[|>][+-]?$/;
const QUOTES = "\"'";
const OPEN = "[{";
const CLOSE = "]}";

/** 引用符・括弧の外にある文字だけを visit(c, i, depth) に渡す。visit が undefined 以外を返したらそれで打ち切る。 */
function scanOutside(text, visit) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (QUOTES.includes(c)) quote = c;
    else if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    const r = visit(c, i, depth);
    if (r !== undefined) return r;
  }
  return undefined;
}

const isCommentStart = (text, c, i) => c === "#" && (i === 0 || /\s/.test(text[i - 1]));

function stripComment(text) {
  const at = scanOutside(text, (c, i) => (isCommentStart(text, c, i) ? i : undefined));
  return (at === undefined ? text : text.slice(0, at)).trimEnd();
}

function flowDepth(text) {
  let last = 0;
  scanOutside(text, (c, i, depth) => {
    last = depth;
    return undefined;
  });
  return last;
}

const joinText = (a, b) => ({ ...a, text: `${a.text} ${b.text}` });

// prettier はフロー形式の長いリストを複数行に折り返す。閉じ括弧まで 1 行に連結してから読む。
function joinFlow(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let ln = lines[i];
    const next = lines[i + 1];
    if (ln.text.endsWith(":") && next?.text.startsWith("[") && next.indent > ln.indent)
      ln = joinText(ln, lines[++i]);
    while (flowDepth(ln.text) > 0 && i + 1 < lines.length) ln = joinText(ln, lines[++i]);
    out.push(ln);
  }
  return out;
}

function tokenize(source) {
  const lines = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    const body = stripComment(raw);
    if (body.trim() === "") return;
    lines.push({ indent: body.length - body.trimStart().length, text: body.trim(), no: i + 1 });
  });
  return joinFlow(lines);
}

function splitFlow(inner) {
  const cuts = [];
  scanOutside(inner, (c, i, depth) => {
    if (c === "," && depth === 0) cuts.push(i);
    return undefined;
  });
  const bounds = [-1, ...cuts, inner.length];
  const parts = bounds.slice(0, -1).map((b, k) => inner.slice(b + 1, bounds[k + 1]));
  return parts.filter((p) => p.trim() !== "");
}

const LITERALS = new Map([
  ["", () => null],
  ["~", () => null],
  ["null", () => null],
  ["true", () => true],
  ["false", () => false],
  ["[]", () => []],
  ["{}", () => ({})],
]);

function parseQuoted(t) {
  if (t.length < 2) return undefined;
  if (t.startsWith('"') && t.endsWith('"')) return JSON.parse(t);
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replaceAll("''", "'");
  return undefined;
}

export function parseScalar(text) {
  const t = text.trim();
  if (LITERALS.has(t)) return LITERALS.get(t)();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const quoted = parseQuoted(t);
  if (quoted !== undefined) return quoted;
  if (t.startsWith("[") && t.endsWith("]")) return splitFlow(t.slice(1, -1)).map(parseScalar);
  if (/^[&*!]/.test(t)) throw new YamlLiteError(`未対応の YAML 構文（アンカー・エイリアス・タグ）: ${t}`);
  return t;
}

function findKeyColon(text) {
  const at = scanOutside(text, (c, i, depth) => {
    const keyEnd = c === ":" && depth === 0 && (i === text.length - 1 || text[i + 1] === " ");
    return keyEnd ? i : undefined;
  });
  return at ?? -1;
}

function parseKey(text) {
  const k = text.trim();
  return QUOTES.includes(k[0]) ? parseScalar(k) : k;
}

function readBlockScalar(state, indent, style) {
  const out = [];
  let blockIndent = null;
  while (state.pos < state.lines.length && state.lines[state.pos].indent > indent) {
    const ln = state.lines[state.pos++];
    blockIndent ??= ln.indent;
    out.push(" ".repeat(ln.indent - blockIndent) + ln.text);
  }
  return style.startsWith(">") ? out.join(" ") : out.join("\n");
}

function parseValueAfterKey(state, rest, indent) {
  if (rest !== "") return BLOCK_SCALAR.test(rest) ? readBlockScalar(state, indent, rest) : parseScalar(rest);
  const next = state.lines[state.pos];
  const nested = next && (next.indent > indent || (next.indent === indent && next.text.startsWith("- ")));
  return nested ? parseBlock(state, next.indent) : null;
}

function parseMap(state, indent, firstEntry) {
  const obj = {};
  let pending = firstEntry;
  while (pending || state.lines[state.pos]?.indent === indent) {
    const ln = pending ?? state.lines[state.pos++];
    pending = null;
    const colon = findKeyColon(ln.text);
    if (colon < 0) throw new YamlLiteError(`行 ${ln.no}: key: value の形ではない: ${ln.text}`);
    obj[parseKey(ln.text.slice(0, colon))] = parseValueAfterKey(
      state,
      ln.text.slice(colon + 1).trim(),
      indent,
    );
  }
  return obj;
}

const isItem = (ln) => ln.text === "-" || ln.text.startsWith("- ");
const looksLikeEntry = (rest) => findKeyColon(rest) > 0 && !rest.startsWith("[") && !QUOTES.includes(rest[0]);

function parseListItem(state, ln, indent) {
  const rest = ln.text.slice(1).trim();
  if (rest === "") {
    const next = state.lines[state.pos];
    return next && next.indent > indent ? parseBlock(state, next.indent) : null;
  }
  if (!looksLikeEntry(rest)) return parseScalar(rest);
  const inner = indent + (ln.text.length - rest.length);
  return parseMap(state, inner, { indent: inner, text: rest, no: ln.no });
}

function parseList(state, indent) {
  const arr = [];
  while (state.pos < state.lines.length) {
    const ln = state.lines[state.pos];
    if (ln.indent !== indent || !isItem(ln)) break;
    state.pos++;
    arr.push(parseListItem(state, ln, indent));
  }
  return arr;
}

function parseBlock(state, indent) {
  return isItem(state.lines[state.pos]) ? parseList(state, indent) : parseMap(state, indent, null);
}

export function parseYaml(source) {
  const lines = tokenize(source);
  if (lines.length === 0) return null;
  const state = { lines, pos: 0 };
  const value = parseBlock(state, lines[0].indent);
  if (state.pos < lines.length) {
    throw new YamlLiteError(`行 ${lines[state.pos].no}: 字下げが想定外: ${lines[state.pos].text}`);
  }
  return value;
}
