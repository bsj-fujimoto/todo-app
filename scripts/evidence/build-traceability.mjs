#!/usr/bin/env node
// 追跡表 docs/data/traceability.csv を生成する（REQ → RISK → VIEW → TC → EXEC → DEF → FND → ACT）。
//   node scripts/evidence/build-traceability.mjs [--check]   # --check は書かずに、いまの表が生成結果と一致するか確かめる
// 元: requirements / risks / perspectives / cases / executions / defects / findings / actions（docs/data/*.csv）。
// 全参照の解決は check-evidence.mjs が検査する。
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { toCsv } from "../ci/lib/csv.mjs";
import { csvPath, readTable, writeTable } from "./lib/data-io.mjs";
import { TRACE_COLUMNS, buildTraceability, summarize } from "./lib/traceability.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["check"] });
const root = resolve(args.root ?? ".");
const rowsOf = (name) => readTable(root, name).rows;

const tables = {
  requirements: rowsOf("requirements"),
  risks: rowsOf("risks"),
  perspectives: rowsOf("perspectives"),
  cases: rowsOf("cases"),
  executions: rowsOf("executions"),
  defects: rowsOf("defects"),
  findings: rowsOf("findings"),
  actions: rowsOf("actions"),
  apiResults: existsSync(csvPath(root, "api-results")) ? rowsOf("api-results") : null,
};
const rows = buildTraceability(tables);

if (args.check) {
  if (readFileSync(csvPath(root, "traceability"), "utf8") !== toCsv(TRACE_COLUMNS, rows)) {
    process.stderr.write(
      "エラー: traceability.csv が生成結果と一致しない（node scripts/evidence/build-traceability.mjs で再生成する）\n",
    );
    process.exit(1);
  }
} else {
  writeTable(root, "traceability", TRACE_COLUMNS, rows);
}
const s = summarize(rows, tables);
process.stdout.write(
  `traceability.csv: ${rows.length} 行（ケース ${s.cases} 行、要求 ${s.requirements}、リスク ${s.risks} が追跡できる。gaps のある行 ${s.gaps}）\n`,
);
