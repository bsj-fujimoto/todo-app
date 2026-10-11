#!/usr/bin/env node
// 依存のライセンスを方針（security/license-policy.yaml）で評価する。違反があれば失敗する。
//   node scripts/security/license-check.mjs --out security-results/license [--root .]
// 入力は package-lock.json と node_modules/*/package.json（外部ツール・外部パッケージに依存しない。SPDX 式は自前で評価する）。
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { readText } from "../ci/lib/repo-fs.mjs";
import { parseYaml } from "../ci/lib/yaml-lite.mjs";
import { readInventory } from "./lib/license-inventory.mjs";
import { evaluate } from "./lib/licenses.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const now = new Date();
const policyPath = args.policy ?? "security/license-policy.yaml";
const policy = parseYaml(readText(root, policyPath));
const entries = readInventory(root);
const result = evaluate(entries, policy, now.toISOString().slice(0, 10));
// 不要になった例外（もうどの依存にも当たらない）は、台帳から外すよう知らせる
const unusedExceptions = (policy.exceptions ?? [])
  .filter((e) => !(e.package in entries))
  .map((e) => e.package);

const report = {
  schema_version: 1,
  generated_at: now.toISOString(),
  commit_sha: process.env.TARGET_SHA || process.env.GITHUB_SHA || null,
  policy_ref: policyPath,
  input: "package-lock.json（+ node_modules/*/package.json）",
  runtime_packages: Object.values(entries).filter((e) => !e.dev).length,
  allow: policy.allow,
  deny_patterns: policy.deny_patterns,
  ...result,
  exceptions_unused: unusedExceptions,
  result: result.violations.length ? "fail" : "pass",
};
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, "license-inventory.json"), `${JSON.stringify(entries, null, 2)}\n`);
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
  ...unusedExceptions.map((p) => `- 不要になった例外（台帳から外す）: ${p}`),
  ...result.violations.map((x) => `  - ${x.package}: ${x.license}（${x.kind}）`),
];
process.stdout.write(`${lines.join("\n")}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
process.exitCode = result.violations.length ? 1 : 0;
