#!/usr/bin/env node
// GitHub Actions ワークフローの統制を機械検査する。逸脱（W1〜W10）があれば失敗する。
//   W1 permissions が明示・最小 / W2 action が SHA 固定 / W3 pull_request_target 不使用 / W4 timeout / W5 concurrency
//   W6 continue-on-error なし / W7 フォーク PR に secret を出さない / W8 OIDC は許可したジョブだけ
//   W9 信頼できない値を run に直接埋め込まない / W10 write 権限は許可リストのジョブだけ
// 許可リストは security/workflow-policy.yaml（理由つき）。使い方: node scripts/security/check-workflows.mjs [--out report.json]
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { parseArgs } from "../ci/lib/args.mjs";
import { isFile, readText, walkFiles } from "../ci/lib/repo-fs.mjs";
import { parseYaml } from "../ci/lib/yaml-lite.mjs";
import { checkComposite, checkWorkflow } from "./lib/workflows.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const policy = isFile(root, "security/workflow-policy.yaml")
  ? (parseYaml(readText(root, "security/workflow-policy.yaml")) ?? {})
  : {};
const load = (rel) => parse(readFileSync(resolve(root, rel), "utf8"));

const workflows = walkFiles(root, ".github/workflows", (p) => /\.ya?ml$/.test(p));
const composites = walkFiles(root, ".github/actions", (p) => /action\.ya?ml$/.test(p));
const violations = [
  ...workflows.flatMap((rel) => checkWorkflow(rel.split("/").pop(), load(rel), policy)),
  ...composites.flatMap((rel) => checkComposite(rel, load(rel))),
];

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  commit_sha: process.env.TARGET_SHA || process.env.GITHUB_SHA || null,
  checked: { workflows, composite_actions: composites },
  rules: ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10"],
  violations,
  result: violations.length ? "fail" : "pass",
};
if (args.out) {
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
}
for (const x of violations)
  process.stdout.write(`[${x.rule}] ${x.file}${x.job ? `#${x.job}` : ""}: ${x.message}\n`);
const line = `ワークフロー統制: ${workflows.length} ワークフロー + ${composites.length} composite を検査 → ${report.result}（違反 ${violations.length} 件）\n`;
process.stdout.write(line);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ワークフロー統制\n\n${line}`);
process.exitCode = violations.length ? 1 : 0;
