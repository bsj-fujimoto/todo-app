// 抽出パリティ: 表（docs/data/*.csv）と md の記載（件数・列）が一致するか。純粋関数。
// 例: docs/03 の「ケース 77 件（TC）」と cases.csv の行数。md に書かれた「N 件（PREFIX）」「N 行（PREFIX）」を全文書から拾って、表の行数と突き合わせる。
import { parseCsvObjects } from "../../ci/lib/csv.mjs";
import { API_DOC, apiResultsParity } from "./api-parity.mjs";
import { DEVIATIONS_DOC, deviationParity } from "./deviations.mjs";

/** ID の接頭辞 → 表（docs/data/<name>.csv）。 */
export const PREFIX_TABLE = {
  REQ: "requirements",
  RISK: "risks",
  VIEW: "perspectives",
  TC: "cases",
  UNK: "unknowns",
  DS: "datasets",
  EXEC: "executions",
  DEF: "defects",
  ACT: "actions",
  FND: "findings",
};

const COUNT_RE = /(\d[\d,]*)\s*(?:件|行)\s*[（(](REQ|RISK|VIEW|TC|UNK|DS|EXEC|DEF|ACT|FND)[）)]/g;

/** md から「N 件（TC）」の記載を拾う。 */
export function countClaims(md) {
  return [...md.matchAll(COUNT_RE)].map((m) => ({
    prefix: m[2],
    count: Number(m[1].replaceAll(",", "")),
    text: m[0],
  }));
}

const PERSPECTIVES = "docs/02-test-perspectives.md";

/** 追加の明示的な規則: 02 の「適用 57 行・非適用 12 行・未決待ち 1 行」のように、列の値ごとの件数。 */
export const VALUE_CLAIMS = [
  {
    doc: PERSPECTIVES,
    table: "perspectives",
    column: "applicability",
    label: "適用",
    value: "applicable",
    re: /(?<!非)適用\s*(\d+)\s*行/,
  },
  {
    doc: PERSPECTIVES,
    table: "perspectives",
    column: "applicability",
    label: "非適用",
    value: "not_applicable",
    re: /非適用\s*(\d+)\s*行/,
  },
  {
    doc: PERSPECTIVES,
    table: "perspectives",
    column: "status",
    label: "未決待ち",
    value: "pending",
    re: /未決待ち[^0-9]*(\d+)\s*行/,
  },
];

/** md が書く列の一覧（`cases.csv` の列: `a`, `b`, ...）→ 列名の配列。 */
export function columnClaim(md, table) {
  const m = new RegExp(`\`${table}\\.csv\`\\s*の列[:：]\\s*([^。\\n]+)`).exec(md);
  return m ? [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]) : null;
}

function countProblems(path, md, tables) {
  const claims = countClaims(md).filter((c) => tables[PREFIX_TABLE[c.prefix]]);
  const problems = claims
    .filter((c) => tables[PREFIX_TABLE[c.prefix]].rows.length !== c.count)
    .map(
      (c) =>
        `${path}: 「${c.text}」だが ${PREFIX_TABLE[c.prefix]}.csv は ${tables[PREFIX_TABLE[c.prefix]].rows.length} 行`,
    );
  return { checked: claims.length, problems };
}

function valueProblems(path, md, tables) {
  const rules = VALUE_CLAIMS.filter((r) => r.doc === path && tables[r.table]);
  const found = rules.map((rule) => ({ rule, match: rule.re.exec(md) })).filter((x) => x.match);
  const problems = [];
  for (const { rule, match } of found) {
    const actual = tables[rule.table].rows.filter((r) => r[rule.column] === rule.value).length;
    if (actual !== Number(match[1])) {
      problems.push(
        `${path}: 「${rule.label} ${match[1]} 行」だが ${rule.table}.csv の ${rule.column}=${rule.value} は ${actual} 行`,
      );
    }
  }
  return { checked: found.length, problems };
}

function columnProblems(path, md, tables) {
  const claims = Object.entries(tables)
    .map(([name, t]) => ({ name, t, cols: columnClaim(md, name) }))
    .filter((c) => c.cols);
  const problems = claims
    .filter((c) => JSON.stringify(c.cols) !== JSON.stringify(c.t.header))
    .map(
      (c) =>
        `${path}: ${c.name}.csv の列の記載が実際の列と違う（md: ${c.cols.join(",")} / CSV: ${c.t.header.join(",")}）`,
    );
  return { checked: claims.length, problems };
}

/**
 * docs: { path → md 本文 }、tables: { name → { header, rows } }（name は docs/data/<name>.csv）。
 * 戻り値: { checked, problems[] }。
 */
export function checkParity(docs, tables) {
  const parts = [
    ...Object.entries(docs).flatMap(([path, md]) => [
      countProblems(path, md, tables),
      valueProblems(path, md, tables),
      columnProblems(path, md, tables),
    ]),
    deviationParity(DEVIATIONS_DOC, docs[DEVIATIONS_DOC], tables.deviations ?? null),
    apiResultsParity(API_DOC, docs[API_DOC], tables["api-results"] ?? null),
  ];
  return { checked: parts.reduce((n, p) => n + p.checked, 0), problems: parts.flatMap((p) => p.problems) };
}

export const parseTable = (text) => parseCsvObjects(text);
