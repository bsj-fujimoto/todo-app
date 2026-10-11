#!/usr/bin/env node
// 変更影響に基づく回帰テストの選択（PR 層）。
//   node scripts/regression/select.mjs --base <sha|ref> [--head HEAD] [--out regression-selection.json]
//   node scripts/regression/select.mjs --files a,b,c          # 変更ファイルを直接指定（テスト用）
//   node scripts/regression/select.mjs --mode full --reason "main への push"   # 全件を強制（main / 日次 / 週次 / リリース）
// マップに無いパスの変更、差分が空、`full: true` のエントリへの該当はすべて全件実行にフォールバックする。
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { changedFiles } from "./lib/git.mjs";
import { loadCases, loadImpactMap, select } from "./lib/impact.mjs";
import { outputLines, renderSelection } from "./lib/select-report.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["github-output"] });
const root = resolve(args.root ?? ".");
const cases = loadCases(root);

function forcedFull(reason) {
  const all = cases.filter((c) => c.automation_layer !== "manual").map((c) => c.test_case_id);
  return {
    changed_files: [],
    mapped: [],
    unmapped_paths: [],
    mode: "full",
    selection_reason: [reason],
    selected_case_ids: all,
    excluded_risks: [],
    grep_e2e: "",
    name_pattern_unit_api: "",
  };
}

function compute() {
  if (args.mode === "full") return forcedFull(args.reason ?? "全件実行が指定された");
  const map = loadImpactMap(root);
  const files = args.files
    ? args.files.split(",").filter(Boolean)
    : changedFiles(root, args.base, args.head ?? "HEAD");
  return select({ map, files, cases });
}

const result = compute();
const meta = {
  sha: process.env.TARGET_SHA || process.env.GITHUB_SHA || "local",
  base: args.base ?? args.mode ?? "-",
};
const report = {
  schema_version: 1,
  commit_sha: meta.sha,
  base: meta.base,
  generated_at: new Date().toISOString(),
  ...result,
};
if (args.out) {
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
}
const md = renderSelection(result, meta);
process.stdout.write(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (args["github-output"] && process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${outputLines(result).join("\n")}\n`);
}
