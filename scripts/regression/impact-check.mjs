#!/usr/bin/env node
// 変更影響マップ（quality/impact-map.yaml）が現状のリポジトリと合っているかを検査する（CI の docs-check ジョブ）。
//   ① git の追跡ファイルがすべてどれかのエントリ（または no_test_impact）に当たる ← 当たらなければ失敗
//   ② 自動化ケースがすべてどれかのエントリから選ばれる
//   ③ マップが参照する TC-ID が cases.csv に実在する
//   ④（警告）どの追跡ファイルにも当たらない glob
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { trackedFiles } from "./lib/git.mjs";
import { loadCases, loadImpactMap } from "./lib/impact.mjs";
import { checkImpactMap } from "./lib/impact-check.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const files = args.files ? args.files.split(",") : trackedFiles(root);
const report = checkImpactMap({ map: loadImpactMap(root), files, cases: loadCases(root) });

for (const e of report.errors) process.stdout.write(`[FAIL] ${e}\n`);
for (const w of report.warnings) process.stdout.write(`[WARN] ${w}\n`);
process.stdout.write(
  `影響マップ検査: ${JSON.stringify(report.stats)} → ${report.errors.length ? "FAIL" : "PASS"}\n`,
);
if (args.out) {
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(
    args.out,
    `${JSON.stringify({ schema_version: 1, ...report, result: report.errors.length ? "fail" : "pass" }, null, 2)}\n`,
  );
}
process.exitCode = report.errors.length ? 1 : 0;
