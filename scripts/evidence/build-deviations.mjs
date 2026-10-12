#!/usr/bin/env node
// 手順からの逸脱の表 docs/data/deviations.csv を、docs/09-test-execution.md の DEV 表（正本）から生成する。
//   node scripts/evidence/build-deviations.mjs [--check]   # --check は書かずに、いまの CSV が生成結果と一致するか確かめる
// 承認の根拠は DEV 表に書かれたとおり（足さない・省かない）。表と CSV のずれは check-parity が検知する。
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { toCsv } from "../ci/lib/csv.mjs";
import { csvPath, writeTable } from "./lib/data-io.mjs";
import { DEVIATIONS_DOC, DEVIATION_COLUMNS, deviationRows, parseDeviationTable } from "./lib/deviations.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["check"] });
const root = resolve(args.root ?? ".");
const md = readFileSync(join(root, DEVIATIONS_DOC), "utf8");
if (!parseDeviationTable(md))
  throw new Error(`${DEVIATIONS_DOC} に DEV の表（| ID | 対象 | 代替手順 | … | 理由 | 承認 |）が無い`);
const rows = deviationRows(md);

if (args.check) {
  let current = null;
  try {
    current = readFileSync(csvPath(root, "deviations"), "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (current !== toCsv(DEVIATION_COLUMNS, rows)) {
    process.stderr.write(
      "エラー: deviations.csv が docs/09 の DEV 表と一致しない（node scripts/evidence/build-deviations.mjs で再生成する）\n",
    );
    process.exit(1);
  }
} else {
  writeTable(root, "deviations", DEVIATION_COLUMNS, rows);
}
process.stdout.write(`deviations.csv: ${rows.length} 行（${rows.map((r) => r.deviation_id).join("・")}）\n`);
