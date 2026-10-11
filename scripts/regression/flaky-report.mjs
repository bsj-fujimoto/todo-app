#!/usr/bin/env node
// 不安定テストの検出と隔離台帳（quality/flaky-ledger.yaml）の検証。
//   node scripts/regression/flaky-report.mjs --junit <dir|xml> [--junit ...] --out flaky-report.json
//   node scripts/regression/flaky-report.mjs --validate-ledger            # 台帳の形式・期限だけを検査（CI の docs-check）
// flaky = 同一 SHA・同一テストで pass と fail が混在。台帳に無い flaky は Issue 候補（label: flaky）として出力する。
// 台帳が空でも、flaky が検出されなければ pass。flaky があれば（台帳にあっても）fail にして、隠さない。
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { asList, parseArgs } from "../ci/lib/args.mjs";
import { readJunitFiles } from "../ci/lib/junit.mjs";
import { analyze, buildReport, loadLedger, validateLedger } from "./lib/flaky.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["validate-ledger"] });
const root = resolve(args.root ?? ".");
const now = new Date();
const today = now.toISOString().slice(0, 10);
const ledger = loadLedger(root);

if (args["validate-ledger"]) {
  const problems = validateLedger(ledger, today);
  for (const p of problems) process.stdout.write(`[FAIL] ${p}\n`);
  process.stdout.write(`flaky 台帳: ${ledger.length} 件 → ${problems.length ? "FAIL" : "PASS"}\n`);
  process.exit(problems.length ? 1 : 0);
}

const { cases, files } = readJunitFiles(asList(args.junit));
const sha = process.env.TARGET_SHA || process.env.GITHUB_SHA || "local";
const report = buildReport({ tests: analyze(cases), ledger, today, sha, nowIso: now.toISOString() });
report.junit_files = files;

if (args.out) {
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
}
const lines = [
  "### flaky 検出",
  "",
  `- 対象 SHA: \`${sha}\` / 観測したテスト ${report.tests_observed} 件（JUnit ${files.length} ファイル）`,
  `- flaky: ${report.flaky.length} 件（台帳外 ${report.issue_candidates.length} 件） / 常時失敗: ${report.consistent_failures.length} 件`,
  `- 隔離台帳: ${report.ledger.entries} 件、問題 ${report.ledger.problems.length} 件`,
  ...report.flaky.map(
    (t) =>
      `  - ${t.tc_ids.join(",") || t.name}: ${t.failures}/${t.runs} 失敗（${t.layer}、台帳 ${t.in_ledger ? "有" : "無"}）`,
  ),
];
process.stdout.write(`${lines.join("\n")}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
process.exitCode = report.result === "fail" ? 1 : 0;
