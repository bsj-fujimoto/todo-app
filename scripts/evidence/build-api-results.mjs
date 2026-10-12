#!/usr/bin/env node
// API テストの結果の機械可読な表 docs/data/api-results.csv を生成する（1 行 = 1 テスト（TC）× 1 endpoint × 1 method）。
//   node scripts/evidence/build-api-results.mjs [--run <run-id>] [--check]
// 材料: backend/test/api-tags.yaml（TC → endpoint・method・タグ）、取り込み済みの run（既定は release.json の run）の JUnit・観察値、
//       backend/test/api/*.test.js（status・header のアサートと契約検証の有無を読む）。
// 観察値の裏付けが無いタグ・実測と合わない endpoint・対応表に無い API 層のケースがあれば、何も書かずに失敗する。
// --check は書かずに、いまの CSV が生成結果と一致するか確かめる。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { toCsv } from "../ci/lib/csv.mjs";
import { parseYaml } from "../ci/lib/yaml-lite.mjs";
import { EVIDENCE_DIR, createReport } from "./lib/common.mjs";
import {
  API_RESULT_COLUMNS,
  apiResultByTc,
  buildApiResults,
  harnessProblems,
  mappingProblems,
  scanTestFlags,
  uncoveredCases,
} from "./lib/api-results.mjs";
import { csvPath, loadCases, writeTable } from "./lib/data-io.mjs";
import { classify } from "./lib/executions.mjs";
import { readReleaseRecord } from "./lib/release-record.mjs";
import { readRun } from "./lib/run-reader.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["check"] });
const root = resolve(args.root ?? ".");
const report = createReport();
const release = readReleaseRecord(root).data;
const runId = String(args.run ?? release?.run_id ?? "");
if (!runId) throw new Error("--run <run-id> が必要（docs/evidence/release.json があれば、その run が既定）");
const runDir = join(root, EVIDENCE_DIR, "runs", runId);
if (!existsSync(runDir)) throw new Error(`${runDir} が無い（fetch-run.mjs で取り込む）`);

const TEST_DIR = join(root, "backend/test/api");
const sources = new Map(
  readdirSync(TEST_DIR)
    .filter((f) => f.endsWith(".test.js"))
    .sort()
    .map((f) => [f, readFileSync(join(TEST_DIR, f), "utf8")]),
);
const mapping = parseYaml(readFileSync(join(root, "backend/test/api-tags.yaml"), "utf8"));
const cases = loadCases(root);
const run = readRun(runDir);

for (const p of harnessProblems(
  readFileSync(join(root, "backend/test/helpers/harness.js"), "utf8"),
  readFileSync(join(root, "backend/test/helpers/contract.js"), "utf8"),
))
  report.error(p);
for (const p of mappingProblems(mapping, new Set(cases.map((c) => c.test_case_id)))) report.error(p);
for (const p of uncoveredCases(cases, mapping)) report.error(p);

// 実装（backend の本体・テスト・契約）が、結果を取った commit から変わっていないこと（変わっていれば、読んだテストの実装と
// JUnit の結果が別の版になる）。作業ツリーと比べる。対象に含めないもの: api-tags.yaml（結果の版に属さない対応表）、
// helpers/contract.js（X の後に `export` を足しただけ。契約検証の中身が content-type を見ることは harnessProblems で確かめる）、
// helpers の新しい補助（api テストが使わないもの）。
const IMPLEMENTATION = [
  "backend/src",
  "backend/test/api",
  "backend/test/helpers/harness.js",
  "backend/test/helpers/assertions.js",
  "backend/test-support",
  "backend/openapi.yaml",
];
if (release) {
  const diff = spawnSync("git", ["diff", "--quiet", release.commit_sha, "--", ...IMPLEMENTATION], {
    cwd: root,
  });
  if (diff.status === 1)
    report.error(
      `backend の実装・テスト・契約が対象 commit ${release.commit_sha.slice(0, 7)} から変わっている（結果と実装が別の版）`,
    );
  else if (diff.status !== 0) report.warn("git で対象 commit との差分を確かめられなかった（履歴が無い環境）");
}

const { rows, problems } = buildApiResults({
  mapping,
  statusByTc: apiResultByTc(run.junit.cases, classify),
  flagsByTc: scanTestFlags(sources),
  observations: run.observations,
  runId: `gh-run-${runId}`,
  runDir: `./${EVIDENCE_DIR}/runs/${runId}`,
});
for (const p of problems) report.error(p);

for (const w of report.warnings) process.stdout.write(`警告: ${w}\n`);
if (!report.ok) {
  for (const e of report.errors) process.stderr.write(`エラー: ${e}\n`);
  process.exit(1);
}
if (args.check) {
  const file = csvPath(root, "api-results");
  if (!existsSync(file) || readFileSync(file, "utf8") !== toCsv(API_RESULT_COLUMNS, rows)) {
    process.stderr.write(
      "エラー: api-results.csv が生成結果と一致しない（node scripts/evidence/build-api-results.mjs で再生成する）\n",
    );
    process.exit(1);
  }
} else {
  writeTable(root, "api-results", API_RESULT_COLUMNS, rows);
}
const count = (pred) => rows.filter(pred).length;
process.stdout.write(
  `api-results.csv: ${rows.length} 行（${new Set(rows.map((r) => r.test_id)).size} テスト。pass ${count((r) => r.status === "pass")}、schema_validated ${count((r) => r.schema_validated === "true")}、asserts_status ${count((r) => r.asserts_status === "true")}、asserts_header ${count((r) => r.asserts_header === "true")}、asserts_content_type ${count((r) => r.asserts_content_type === "true")}）対象 run ${runId}\n`,
);
