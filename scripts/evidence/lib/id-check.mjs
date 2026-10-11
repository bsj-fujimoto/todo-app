// docs/data/*.csv の ID 参照がすべて解決するか（REQ/RISK/VIEW/TC/UNK/DS/EXEC/DEF/FND/ACT/EV）。純粋関数。
// scripts/ci/lib/docs-checks.mjs の checkIdReferences と同じ考え方で、証拠 ID（EV）まで含める。
const PREFIXES = "REQ|RISK|VIEW|TC|UNK|DS|EXEC|DEF|FND|ACT|EV";
const ID_RE = new RegExp(`\\b(?:${PREFIXES})-\\d+\\b`, "g");
const ID_ONLY = new RegExp(`^(?:${PREFIXES})-\\d+$`);

/** 表の ID 列（id または *_id で終わる最初の列。無ければ先頭列）。 */
export const idColumn = (header) => header.find((h) => h === "id" || h.endsWith("_id")) ?? header[0];

const definedIds = (tables) =>
  new Set(
    Object.values(tables).flatMap((t) => {
      const col = idColumn(t.header);
      return t.rows.map((r) => r[col] ?? "").filter((v) => ID_ONLY.test(v));
    }),
  );

/** 1 行の中の ID 参照（[{ id, where }]）。 */
function rowReferences(name, t, row) {
  const key = row[idColumn(t.header)] ?? "?";
  return Object.entries(row).flatMap(([column, value]) =>
    [...String(value).matchAll(ID_RE)].map((m) => ({ id: m[0], where: `${name}.csv ${key}.${column}` })),
  );
}

/** tables: { name → { header, rows } }。戻り値: { defined:Set, references, unresolved:[{ id, where }] }。 */
export function checkReferences(tables) {
  const defined = definedIds(tables);
  const refs = Object.entries(tables).flatMap(([name, t]) =>
    t.rows.flatMap((r) => rowReferences(name, t, r)),
  );
  return { defined, references: refs.length, unresolved: refs.filter((r) => !defined.has(r.id)) };
}
