#!/usr/bin/env node
// 全 scan-run.json の完全性を検査する（tool・version・config / rules・exclusions・thresholds・command・output_location・coverage・target.commit_sha・
// イメージ検査の target.image_digest・check_kind の語彙）。足りない記録があれば exit 1。
//   node scripts/security/check-scan-runs.mjs --results security-results [--out security-findings/scan-run-check.json]
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { checkScanRuns } from "./lib/scan-run-check.mjs";

const args = parseArgs(process.argv.slice(2));
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const runs = walk(args.results)
  .filter((p) => basename(p) === "scan-run.json")
  .map((p) => JSON.parse(readFileSync(p, "utf8")));
const problems = checkScanRuns(runs);
const report = {
  schema_version: 1,
  runs: runs.length,
  by_kind: Object.fromEntries(
    [...new Set(runs.map((r) => r.check_kind))]
      .sort()
      .map((k) => [k, runs.filter((r) => r.check_kind === k).map((r) => r.scan)]),
  ),
  problems,
  result: problems.length ? "fail" : "pass",
};
if (args.out) {
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
}
const lines = [
  `scan-run の完全性: ${runs.length} 件 → ${report.result}`,
  ...problems.map((p) => `[FAIL] ${p}`),
];
process.stdout.write(`${lines.join("\n")}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### scan-run の完全性\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`,
  );
process.exitCode = problems.length ? 1 : 0;
