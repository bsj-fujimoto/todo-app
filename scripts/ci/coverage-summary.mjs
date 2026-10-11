#!/usr/bin/env node
// node:test のカバレッジ表（標準出力を保存したテキスト）→ coverage-summary.json。
//   node scripts/ci/coverage-summary.mjs --in backend/test-results/test-output.txt --out backend/test-results/coverage-summary.json
// 表が見つからなければ失敗する（カバレッジを取れていないのに成功にしない）。
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "./lib/args.mjs";
import { parseCoverage } from "./lib/coverage.mjs";

const args = parseArgs(process.argv.slice(2));
const { total, files } = parseCoverage(readFileSync(args.in, "utf8"));
if (!total) {
  process.stderr.write(`カバレッジの表（all files 行）が ${args.in} に無い\n`);
  process.exit(1);
}
const summary = {
  schema_version: 1,
  source: args.in,
  commit_sha: process.env.TARGET_SHA || process.env.GITHUB_SHA || null,
  generated_at: new Date().toISOString(),
  total,
  files,
};
writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(
  `カバレッジ: lines ${total.lines}% / branches ${total.branches}% / functions ${total.functions}%（${files.length} ファイル）\n`,
);
