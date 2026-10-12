// 手順からの逸脱（DEV）。正本は docs/09-test-execution.md の「execution-03」の DEV 表。docs/data/deviations.csv はそこから機械的に作る。純粋関数。
// 列は qc-analyzer の Deviation と同じ: deviation_id, execution_id, steps, reason, approved_by。
//   execution_id … 対象の実施 ID の先頭 1 つ（qc の Deviation.execution_id は 1 つの文字列で、複数値の分割対象でない）。
//                  複数の行にまたがる逸脱は、対象の全文（実施 ID・ケース）を steps の先頭に「対象: …」として残す。
//   steps        … 「対象: <対象の列>。代替手順: <代替手順の列>。差分: <差分の列>」
//   reason       … 表の理由の列
//   approved_by  … 表の承認の列（ロールと根拠。表に書かれたとおり。足さない・省かない）
// 表の列の見出しは先頭一致で見る（括弧の注記は無視する）。
export const DEVIATIONS_DOC = "docs/09-test-execution.md";
export const DEVIATION_COLUMNS = ["deviation_id", "execution_id", "steps", "reason", "approved_by"];

const HEADS = [
  ["id", /^ID$/],
  ["target", /^対象/],
  ["steps", /^代替手順/],
  ["diff", /^差分/],
  ["reason", /^理由/],
  ["approval", /^承認/],
];

const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** 太字の記号（**）だけを外す。語句・数字・括弧は表のまま。 */
const plain = (text) => text.replaceAll("**", "").replace(/\s+/g, " ").trim();

/** 見出し行の列の位置 → { id, target, steps, diff, reason, approval }。DEV の表の見出しでなければ null。 */
function columnIndex(headerCells) {
  const index = {};
  for (const [key, re] of HEADS) {
    const i = headerCells.findIndex((c) => re.test(c));
    if (i === -1) return null;
    index[key] = i;
  }
  return index;
}

/** md から DEV の表を探して、行（{ id, target, steps, diff, reason, approval }）を返す。表が無ければ null。 */
export function parseDeviationTable(md) {
  const lines = md.split("\n");
  for (let i = 0; i < lines.length - 2; i += 1) {
    const index = lines[i].startsWith("|") ? columnIndex(cells(lines[i])) : null;
    if (!index || !/^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) continue;
    const rows = [];
    for (const line of lines.slice(i + 2)) {
      if (!line.startsWith("|")) break;
      const c = cells(line);
      if (/^DEV-\d+$/.test(c[index.id])) {
        rows.push(Object.fromEntries(Object.entries(index).map(([key, at]) => [key, plain(c[at] ?? "")])));
      }
    }
    return rows;
  }
  return null;
}

/** DEV の表の 1 行 → deviations.csv の 1 行。 */
export function deviationRow(r) {
  return {
    deviation_id: r.id,
    execution_id: /EXEC-\d+/.exec(r.target)?.[0] ?? "",
    steps: `対象: ${r.target}。代替手順: ${r.steps}。差分: ${r.diff}`,
    reason: r.reason,
    approved_by: r.approval,
  };
}

export const deviationRows = (md) => (parseDeviationTable(md) ?? []).map(deviationRow);

/** 期待の行 1 つに対する CSV の行の食い違い。 */
function rowProblem(path, want, rows) {
  const got = rows.find((r) => r.deviation_id === want.deviation_id);
  if (!got) return [`${path}: ${want.deviation_id} が deviations.csv に無い`];
  const bad = DEVIATION_COLUMNS.filter((col) => got[col] !== want[col]);
  return bad.length === 0
    ? []
    : [
        `${path}: ${want.deviation_id} の ${bad.join("・")} が deviations.csv と違う（build-deviations.mjs で再生成する）`,
      ];
}

/** CSV の列・件数の食い違い（行ごとの比較の前）。 */
function shapeProblems(path, want, table) {
  return [
    ...(JSON.stringify(table.header) === JSON.stringify(DEVIATION_COLUMNS)
      ? []
      : [
          `${path}: deviations.csv の列が違う（CSV: ${table.header.join(",")} / 期待: ${DEVIATION_COLUMNS.join(",")}）`,
        ]),
    ...(want.length === table.rows.length
      ? []
      : [`${path}: DEV 表は ${want.length} 件だが deviations.csv は ${table.rows.length} 行`]),
  ];
}

/**
 * docs/09 の DEV 表と deviations.csv が一致するか。戻り値: { checked, problems[] }。
 * table: { header, rows }（無ければ null）。docs/09 が DEV 表を持たなければ検査しない（checked 0）。
 */
export function deviationParity(path, md, table) {
  const expected = md === undefined ? null : parseDeviationTable(md);
  if (!expected) return { checked: 0, problems: [] };
  if (!table) return { checked: 1, problems: [`${path}: DEV 表があるが docs/data/deviations.csv が無い`] };
  const want = expected.map(deviationRow);
  return {
    checked: want.length,
    problems: [...shapeProblems(path, want, table), ...want.flatMap((w) => rowProblem(path, w, table.rows))],
  };
}
