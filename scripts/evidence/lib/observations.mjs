// テストが残した観察値（observations/*.json）→ 実施表の actual_result（実測の要約）。
// 期待結果の転記ではなく、観察値（画面・通信・計測・入力→結果の実測表）だけから文を組む。純粋関数。
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ERROR_CODE = /"code":"([A-Z_]+)"/;
const MAX_ACTUAL_CHARS = 700;

export function clipText(value, max) {
  const chars = [...String(value ?? "")];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

const quote = (text) => `「${text}」`;

function rowText(row) {
  return `${row.text}${row.checked ? "(済)" : ""}${row.busy ? "(通信中)" : ""}`;
}

const labelled = (label, value) => (value ? `${label}${quote(value)}` : null);

function listPart(screen) {
  if (!screen.row_count) return "一覧 0 行";
  const omitted = screen.rows_omitted ? ` ほか ${screen.rows_omitted} 行` : "";
  return `一覧 ${screen.row_count} 行 [${screen.rows.map(rowText).join(", ")}${omitted}]`;
}

function screenParts(screen) {
  if (!screen) return [];
  return [
    listPart(screen),
    screen.input_value ? labelled("入力欄", screen.input_value) : "入力欄は空",
    labelled("保存エラー", screen.save_error),
    labelled("入力エラー", screen.input_error),
    labelled("一覧メッセージ", screen.list_message),
    labelled("フォーカス", screen.focus),
  ].filter(Boolean);
}

const callLabel = (c) => {
  const code = ERROR_CODE.exec(c.response ?? "")?.[1];
  return `${c.method} ${c.path.replace(UUID, "{id}").replaceAll("{uuid}", "{id}")}→${c.status}${code ? ` ${code}` : ""}`;
};

/** 連続する同じ呼び出しは ×n にまとめる。 */
export function callsText(calls, omitted = 0) {
  const groups = [];
  for (const label of calls.map(callLabel)) {
    const last = groups.at(-1);
    if (last?.label === label) last.count += 1;
    else groups.push({ label, count: 1 });
  }
  const text = groups.map((g) => (g.count > 1 ? `${g.label} ×${g.count}` : g.label)).join(", ");
  return text ? `API: ${text}${omitted ? ` ほか ${omitted} 件` : ""}` : null;
}

function tableParts(table, omitted) {
  if (table.length === 0) return [];
  const shown = table
    .slice(0, 5)
    .map((r) => `${r.input}→${r.result}`)
    .join(" / ");
  const rest = table.length - 5 + omitted;
  return [`入力→結果 ${table.length + omitted} 件: ${shown}${rest > 0 ? ` ほか ${rest} 件` : ""}`];
}

/** 観察 entry 1 件 → 実測の要約文。 */
export function describeEntry(entry) {
  const parts = [
    ...screenParts(entry.screen),
    callsText(entry.api_calls ?? [], entry.api_calls_omitted ?? 0),
    ...(entry.notes ?? []).map((n) => `${n.label}: ${n.value}`),
    ...tableParts(entry.table ?? [], entry.table_omitted ?? 0),
  ].filter(Boolean);
  return parts.join("。");
}

/** 同じ行（TC × 環境）に属する複数のテストの観察 → 1 つの actual_result。 */
export function actualResultOf(entries) {
  const texts = entries.map(describeEntry).filter(Boolean);
  const joined = texts.length > 1 ? texts.map((t, i) => `(${i + 1}) ${t}`).join(" ") : (texts[0] ?? "");
  return clipText(joined.replace(UUID, "{id}").replaceAll("{uuid}", "{id}"), MAX_ACTUAL_CHARS);
}
