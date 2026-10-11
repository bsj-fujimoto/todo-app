#!/usr/bin/env node
// 抽出パリティ: 表（docs/data/*.csv）と md の記載が一致するか（件数・列）。不一致があれば失敗する。
//   node scripts/evidence/check-parity.mjs [--root .]
// 例: docs/03 が書く「ケース 77 件（TC）」と cases.csv の行数。md の「N 件（REQ|RISK|VIEW|TC|UNK|DS|EXEC|DEF|ACT|FND）」を全文書から拾う。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { DATA_DIR } from "./lib/common.mjs";
import { checkParity, parseTable } from "./lib/parity.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");

const tables = {};
for (const file of readdirSync(join(root, DATA_DIR)).filter((f) => f.endsWith(".csv"))) {
  tables[file.replace(/\.csv$/, "")] = parseTable(readFileSync(join(root, DATA_DIR, file), "utf8"));
}
const docs = {};
for (const file of readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md"))) {
  docs[`docs/${file}`] = readFileSync(join(root, "docs", file), "utf8");
}
if (existsSync(join(root, "docs/evidence/README.md")))
  docs["docs/evidence/README.md"] = readFileSync(join(root, "docs/evidence/README.md"), "utf8");

const { checked, problems } = checkParity(docs, tables);
for (const p of problems) process.stderr.write(`エラー: ${p}\n`);
process.stdout.write(
  `parity: ${Object.keys(docs).length} 文書・${Object.keys(tables).length} 表を突き合わせ（記載 ${checked} 件）→ ${problems.length ? `${problems.length} 件の不一致` : "一致"}\n`,
);
process.exitCode = problems.length ? 1 : 0;
