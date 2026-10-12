// docs/06 の「検査の種類ごとの適用」の数字（status 27 / 27 など）と docs/data/api-results.csv の一致。純粋関数。
// 数字はテスト（TC）単位: その TC のすべての行で true のものを 1 件と数える（api-results.csv の asserts_*・schema_validated）。
export const API_DOC = "docs/06-api-test.md";

/** 表の行ラベル → api-results.csv の列。 */
const CLAIMS = [
  ["status のアサート", "asserts_status"],
  ["契約スキーマでの本文検証", "schema_validated"],
  ["content-type の検証", "asserts_content_type"],
  ["content-type 以外の header のアサート", "asserts_header"],
];

const claimRe = (label) => new RegExp(`\\|\\s*${label}\\s*\\|\\s*(\\d+)\\s*/\\s*(\\d+)\\s*\\|`);

/** テスト単位の集計 → { total, count(列) }。 */
export function countByTest(rows) {
  const tests = new Map();
  for (const r of rows) tests.set(r.test_id, [...(tests.get(r.test_id) ?? []), r]);
  const count = (col) => [...tests.values()].filter((rs) => rs.every((r) => r[col] === "true")).length;
  return { total: tests.size, count };
}

/** md の数字と表の集計の不一致。戻り値: { checked, problems[] }。表が無ければ検査しない（checked 0）。 */
export function apiResultsParity(path, md, table) {
  const found = CLAIMS.map(([label, col]) => ({ label, col, m: claimRe(label).exec(md ?? "") })).filter(
    (c) => c.m,
  );
  if (found.length === 0) return { checked: 0, problems: [] };
  if (!table)
    return {
      checked: found.length,
      problems: [`${path}: api-results.csv が無い（build-api-results.mjs で生成する）`],
    };
  const { total, count } = countByTest(table.rows);
  const problems = found.flatMap(({ label, col, m }) => {
    const [claimed, of] = [Number(m[1]), Number(m[2])];
    const actual = count(col);
    return claimed === actual && of === total
      ? []
      : [
          `${path}: 「${label} ${claimed} / ${of}」だが api-results.csv の ${col} は ${actual} / ${total}（テスト単位）`,
        ];
  });
  return { checked: found.length, problems };
}
