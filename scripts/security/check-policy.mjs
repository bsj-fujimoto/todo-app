#!/usr/bin/env node
// セキュリティ方針ファイル（zap-rules.tsv・triage.yaml・accepted-risks.yaml・license-policy.yaml・dependency-selection.yaml）の
// 形式と期限を検査する。受容・除外・例外は「理由・owner・期限」が揃い、期限内であることが条件。
import { resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { checkPolicy } from "./lib/policy.mjs";

const args = parseArgs(process.argv.slice(2));
const problems = checkPolicy(resolve(args.root ?? "."), new Date().toISOString().slice(0, 10));
for (const p of problems) process.stdout.write(`[FAIL] ${p}\n`);
process.stdout.write(
  `セキュリティ方針ファイル: ${problems.length ? "FAIL" : "PASS"}（問題 ${problems.length} 件）\n`,
);
process.exitCode = problems.length ? 1 : 0;
