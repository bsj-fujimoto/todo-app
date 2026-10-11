#!/usr/bin/env node
// 依存のライセンスを方針（security/license-policy.yaml）で評価する。違反があれば失敗する。
//   node scripts/security/license-check.mjs --input security-results/license/license-checker-all.json --out security-results/license
// 入力は license-checker-rseidelsohn の --json 出力（--excludePrivatePackages 付き）。
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { readText } from "../ci/lib/repo-fs.mjs";
import { parseYaml } from "../ci/lib/yaml-lite.mjs";
import { evaluate } from "./lib/licenses.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const now = new Date();
const policyPath = args.policy ?? "security/license-policy.yaml";
const policy = parseYaml(readText(root, policyPath));
const entries = JSON.parse(readFileSync(args.input, "utf8"));
const result = evaluate(entries, policy, now.toISOString().slice(0, 10));

const report = {
  schema_version: 1,
  generated_at: now.toISOString(),
  commit_sha: process.env.TARGET_SHA || process.env.GITHUB_SHA || null,
  policy_ref: policyPath,
  input: args.input,
  allow: policy.allow,
  deny_patterns: policy.deny_patterns,
  ...result,
  result: result.violations.length ? "fail" : "pass",
};
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, "license-report.json"), `${JSON.stringify(report, null, 2)}\n`);

const dist = Object.entries(result.by_license)
  .sort((a, b) => b[1] - a[1])
  .map(([l, n]) => `${l} ${n}`)
  .join(" / ");
const lines = [
  "### ライセンス検査",
  "",
  `- 方針: \`${policyPath}\`（許可 ${policy.allow.length} 種、禁止パターン ${policy.deny_patterns.length} 個）`,
  `- 対象 ${result.packages} パッケージ: ${dist}`,
  `- 違反: ${result.violations.length} 件 / 期限内の例外: ${result.exceptions_used.length} 件`,
  ...result.violations.map((x) => `  - ${x.package}: ${x.license}（${x.kind}）`),
];
process.stdout.write(`${lines.join("\n")}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
process.exitCode = result.violations.length ? 1 : 0;
