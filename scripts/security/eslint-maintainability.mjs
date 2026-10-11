#!/usr/bin/env node
// 保守性の検査（ESLint の複雑度・大きさ・引数・ネスト・純粋性）を実行し、SARIF と閾値の記録を書く。
//   node scripts/security/eslint-maintainability.mjs --out-dir security-results/maintainability
// lint ジョブ（ci.yml の `eslint .`）と同じ設定（eslint.config.js）を使う。保守性ルールの違反があれば exit 1。
// 出力: eslint-maintainability.sarif（結果）、thresholds.json（ルールごとの閾値・分類）、summary.json（件数）。
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { ruleClasses, summarize, thresholdsFrom, toSarif } from "./lib/maintainability.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const outDir = resolve(args["out-dir"] ?? "security-results/maintainability");
const probe = args.probe ?? "backend/src/app.js";
const eslint = join(root, "node_modules/eslint/bin/eslint.js");

function runEslint(eslintArgs) {
  const r = spawnSync(process.execPath, [eslint, ...eslintArgs], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error || r.status === null || r.status > 1) {
    process.stderr.write(`eslint が実行できなかった（exit ${r.status}）: ${r.error ?? r.stderr}\n`);
    process.exit(2);
  }
  return r.stdout;
}

const results = JSON.parse(runEslint([".", "--format", "json"]));
const thresholds = thresholdsFrom(JSON.parse(runEslint(["--print-config", probe])));
const version = runEslint(["--version"]).trim().replace(/^v/, "");
const summary = summarize(results);
const total = Object.values(summary.violations).reduce((a, b) => a + b, 0);

mkdirSync(outDir, { recursive: true });
const write = (name, doc) => writeFileSync(join(outDir, name), `${JSON.stringify(doc, null, 2)}\n`);
write("eslint-maintainability.sarif", toSarif(results, { version, thresholds, root }));
write("thresholds.json", thresholds);
write("summary.json", { eslint_version: version, rule_classes: ruleClasses(), ...summary, total });

process.stdout.write(
  `保守性（ESLint ${version}）: ${summary.files} ファイル、違反 ${total} 件 ${JSON.stringify(summary.violations)}\n` +
    `閾値: ${Object.entries(thresholds)
      .map(([id, t]) => `${id}=${JSON.stringify(t.value)}`)
      .join(", ")}\n`,
);
process.exitCode = total > 0 ? 1 : 0;
