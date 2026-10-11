#!/usr/bin/env node
// レイヤー依存の検査。security/architecture.yaml の宣言と、backend/src・frontend/src の import 文を突き合わせる。
//   node scripts/security/check-arch.mjs [--config security/architecture.yaml] [--out security-results/architecture/arch.json]
// 違反（宣言外の向き・許可外の外部依存・未分類のファイル・解決できない import）と循環があれば exit 1。
// arch.json には、レイヤーごとのファイル・レイヤー間の依存の本数・違反・循環・config_ref・対象 commit を残す。
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { readText, walkFiles } from "../ci/lib/repo-fs.mjs";
import { parseYaml } from "../ci/lib/yaml-lite.mjs";
import { analyzeSystem, validateConfig } from "./lib/arch.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const configRef = args.config ?? "security/architecture.yaml";
const config = parseYaml(readText(root, configRef));
const configProblems = validateConfig(config);

function readSources(system) {
  const files = walkFiles(root, system.root, (f) => /\.(m?js)$/.test(f));
  return new Map(files.map((f) => [f.slice(system.root.length + 1), readText(root, f)]));
}

const systems = configProblems.length ? [] : config.systems.map((s) => analyzeSystem(s, readSources(s)));
const violations = systems.flatMap((s) => s.violations.map((v) => ({ system: s.id, ...v })));
const cycles = systems.flatMap((s) => s.cycles.map((c) => ({ system: s.id, files: c })));
const result = configProblems.length || violations.length || cycles.length ? "fail" : "pass";
const report = {
  schema_version: 1,
  config_ref: configRef,
  target_commit: process.env.TARGET_SHA ?? process.env.GITHUB_SHA ?? null,
  config_problems: configProblems,
  systems,
  summary: {
    systems: systems.length,
    files: systems.reduce((n, s) => n + s.files, 0),
    violations: violations.length,
    cycles: cycles.length,
  },
  result,
};
if (args.out) {
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
}

const lines = [
  `アーキテクチャ検査: ${systems.map((s) => `${s.id} ${s.files} ファイル`).join(" / ")} → 違反 ${violations.length}、循環 ${cycles.length}（${result}）`,
  ...systems.flatMap((s) => s.layer_edges.map((e) => `  ${s.id}: ${e.edge}（${e.count}）`)),
  ...configProblems.map((p) => `[FAIL] 設定: ${p}`),
  ...violations.map((v) => `[FAIL] ${v.system}: ${v.from}: ${v.message}`),
  ...cycles.map((c) => `[FAIL] ${c.system}: 循環 ${c.files.join(" ⇄ ")}`),
];
process.stdout.write(`${lines.join("\n")}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### アーキテクチャ（レイヤー依存）\n\n${lines.map((l) => `- ${l.trim()}`).join("\n")}\n`,
  );
process.exitCode = result === "pass" ? 0 : 1;
