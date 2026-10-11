#!/usr/bin/env node
// OWASP ZAP の JSON レポート → SARIF（security/zap-rules.tsv の IGNORE / FAIL を適用）。
//   node scripts/security/zap-to-sarif.mjs --in security-results/zap/zap-baseline.json --out security-results/zap/zap-baseline.sarif --rules security/zap-rules.tsv
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "../ci/lib/args.mjs";
import { parseRules, zapToSarif } from "./lib/zap.mjs";

const args = parseArgs(process.argv.slice(2));
const rules = parseRules(readFileSync(args.rules ?? "security/zap-rules.tsv", "utf8"));
const { sarif, ignored } = zapToSarif(JSON.parse(readFileSync(args.in, "utf8")), rules, {
  source: args.in,
  rules_ref: args.rules ?? "security/zap-rules.tsv",
});
writeFileSync(args.out, `${JSON.stringify(sarif, null, 2)}\n`);
writeFileSync(
  args.out.replace(/\.sarif$/, "-ignored.json"),
  `${JSON.stringify({ rules_ref: args.rules, ignored }, null, 2)}\n`,
);
process.stdout.write(
  `ZAP → SARIF: 検出 ${sarif.runs[0].results.length} 件、zap-rules.tsv の IGNORE で除外 ${ignored.length} 件 → ${args.out}\n`,
);
