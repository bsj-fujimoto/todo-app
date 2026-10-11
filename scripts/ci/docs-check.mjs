#!/usr/bin/env node
// docs/ とテストの整合検査（依存ゼロ）。
//   ① docs/data/*.csv の ID 参照 ② docs/evidence/manifest.json の sha256 ③ テスト名の [TC-xxx] ↔ cases.csv
//   ④ Markdown の相対リンク
// 使い方: node scripts/ci/docs-check.mjs [--root .] [--out docs-check-report.json]
// docs/ がまだ薄くても落ちない（対象が無い検査は「skipped」と理由つきで表示する）。
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "./lib/args.mjs";
import {
  checkIdReferences,
  checkManifest,
  checkMarkdownLinks,
  checkTestCoverage,
} from "./lib/docs-checks.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const now = new Date();
const today = now.toISOString().slice(0, 10);

const checks = [
  checkIdReferences(root),
  checkManifest(root),
  checkTestCoverage(root, today),
  checkMarkdownLinks(root),
];
const failed = checks.filter((c) => c.status === "fail");
const report = {
  schema_version: 1,
  generated_at: now.toISOString(),
  commit_sha: process.env.TARGET_SHA || process.env.GITHUB_SHA || null,
  checks,
  result: failed.length ? "fail" : "pass",
};

const icon = { pass: "PASS", fail: "FAIL", skipped: "SKIP" };
const lines = checks.flatMap((c) => [
  `[${icon[c.status]}] ${c.title}`,
  ...c.messages.map((m) => `    - ${m}`),
  ...(c.warnings ?? []).map((m) => `    ! ${m}`),
]);
process.stdout.write(`${lines.join("\n")}\n`);

if (args.out) {
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const md = checks.map((c) => `| ${c.status} | ${c.title} | ${c.messages.length} |`);
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### docs-check\n\n| 結果 | 検査 | 指摘 |\n|---|---|---:|\n${md.join("\n")}\n`,
  );
}
process.exitCode = failed.length ? 1 : 0;
