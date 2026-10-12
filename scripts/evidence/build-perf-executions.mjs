#!/usr/bin/env node
// 取り込み済みの性能試験の結果（docs/evidence/perf/）から、実施表に kind=performance の行を足す（perf 層の SLO 判定）。
//   node scripts/evidence/build-perf-executions.mjs [--root .] [--dry-run]
// 結び付けは perf/slo.yaml の test_cases。対象版（docs/evidence/release.json の commit X）の run だけを行にする
// （別の commit の run は対象版の結果でない。履歴として run-roles.yaml に残し、実施表の根拠にしない）。
// 同じ run の行は置き換える（再実行しても同じ結果）。検査に失敗したら何も書かない。
// composition root: ファイル入出力をここで束ねる。
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { EVIDENCE_DIR, createReport, readJson } from "./lib/common.mjs";
import {
  loadCases,
  loadDefectIds,
  loadEvidenceRows,
  loadExecutions,
  readYaml,
  saveEvidenceRows,
  saveExecutions,
} from "./lib/data-io.mjs";
import { fileEntry } from "./lib/evidence-files.mjs";
import { createRegistry } from "./lib/evidence-registry.mjs";
import { checkActualResults, checkRows, checkSingleVersion } from "./lib/execution-checks.mjs";
import { assignIds, mergeRows } from "./lib/execution-merge.mjs";
import { compareRows } from "./lib/executions.mjs";
import { buildPerfRows } from "./lib/perf-rows.mjs";
import { readReleaseRecord } from "./lib/release-record.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["dry-run"] });
const root = resolve(args.root ?? ".");
const report = createReport();
const evidenceDir = join(root, EVIDENCE_DIR);

/** docs/evidence/perf/<perf-results-ID>/<run ディレクトリ>/（run.json があるディレクトリ）の相対パス（docs/evidence から）。 */
function resultsDir(source) {
  const base = join(evidenceDir, "perf", `perf-results-${source.run_id}`);
  const dir = existsSync(base) ? readdirSync(base).find((d) => existsSync(join(base, d, "run.json"))) : null;
  if (!dir)
    throw new Error(
      `perf の結果ディレクトリ（run.json を含む）が ${base} に無い（fetch-run.mjs --kind perf）`,
    );
  return `perf/perf-results-${source.run_id}/${dir}`;
}

const sourceFile = join(evidenceDir, "perf", "SOURCE.json");
if (!existsSync(sourceFile))
  throw new Error("docs/evidence/perf/SOURCE.json が無い（perf の結果を取り込んでいない）");
const source = readJson(sourceFile);
const release = readReleaseRecord(root).data;
if (!release) throw new Error("docs/evidence/release.json が無い、または読めない（対象版を決められない）");
if (source.head_sha !== release.commit_sha) {
  process.stdout.write(
    `perf の run ${source.run_id} は対象 ${source.head_sha}。リリース ${release.release} の対象 ${release.commit_sha} と別なので、実施表には入れない（履歴: run-roles.yaml）\n`,
  );
  process.exit(0);
}

const dir = resultsDir(source);
const read = (rel) => readJson(join(evidenceDir, dir, rel));
const entryOf = (rel) => fileEntry(evidenceDir, `${dir}/${rel}`);
const verdicts = Object.fromEntries(
  ["load", "screen"]
    .filter((s) => existsSync(join(evidenceDir, dir, s, "verdict.json")))
    .map((s) => [s, read(`${s}/verdict.json`)]),
);
const cases = loadCases(root);
const registry = createRegistry(loadEvidenceRows(root));
const built = buildPerfRows({
  runId: source.run_id,
  sha: source.head_sha,
  run: read("run.json"),
  verdicts,
  slos: readYaml(root, "perf/slo.yaml")?.slos,
  caseIds: new Set(cases.map((c) => c.test_case_id)),
  evidenceFor: (scenario) => entryOf(`${scenario}/verdict.json`),
  runEntry: entryOf("run.json"),
}).sort(compareRows);
if (built.length === 0) throw new Error("perf/slo.yaml の test_cases に結び付く判定が無く、行を作れない");
for (const row of built) row.evidence_ids = row._evidence.map((e) => registry.allocate(e)).join(";");

const runRef = `gh-run-${source.run_id}`;
const rows = assignIds(mergeRows({ existing: loadExecutions(root), built, runRef, prune: false, report }));
checkActualResults(
  rows.filter((r) => r.run_ref === runRef),
  cases,
  report,
);
checkSingleVersion(rows, report, release.commit_sha);
checkRows(
  rows,
  {
    caseIds: new Set(cases.map((c) => c.test_case_id)),
    evidenceIds: new Set(registry.rows().map((r) => r.evidence_id)),
    defectIds: loadDefectIds(root),
  },
  report,
);

for (const w of report.warnings) process.stdout.write(`警告: ${w}\n`);
if (!report.ok) {
  for (const e of report.errors) process.stderr.write(`エラー: ${e}\n`);
  process.exit(1);
}
if (!args["dry-run"]) {
  saveExecutions(root, rows);
  saveEvidenceRows(root, registry.rows());
}
const mine = rows.filter((r) => r.run_ref === runRef);
process.stdout.write(
  `executions.csv: ${rows.length} 行（perf run ${source.run_id} の ${mine.length} 行: ${mine.map((r) => `${r.test_case_id} ${r.status}`).join(" / ")}）対象 SHA ${source.head_sha}\n`,
);
