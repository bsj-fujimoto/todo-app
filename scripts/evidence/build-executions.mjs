#!/usr/bin/env node
// CI run の結果（JUnit・観察値・ci-summary.json・regression-selection.json）から docs/data/executions.csv を生成する。
//   node scripts/evidence/build-executions.mjs --run <run-id>        # docs/evidence/runs/<id>/ が無ければ fetch-run.mjs で取得する
//   node scripts/evidence/build-executions.mjs --run <id> --artifacts <gh run download の出力>   # 取得済みの artifact から取り込む
// 同じ run の行は置き換える（再実行しても同じ結果）。別の版（commit_sha）の行が残っているときは、
// 版の混在を避けるため失敗する（--prune-other-versions で他の版の行を捨てる）。
// 検査に失敗したら何も書かない。composition root: 時刻・子プロセス・ファイル入出力をここで束ねる。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { loadKnownGaps } from "../ci/lib/docs-checks.mjs";
import { EVIDENCE_DIR, createReport } from "./lib/common.mjs";
import {
  loadCases,
  loadEvidenceRows,
  loadDefectIds,
  loadExecutions,
  loadManualPlan,
  openDefectsByCase,
  saveEvidenceRows,
  saveExecutions,
  verifiedDefectsByCase,
} from "./lib/data-io.mjs";
import { createRegistry } from "./lib/evidence-registry.mjs";
import { buildRunRows } from "./lib/execution-rows.mjs";
import { assignIds, mergeRows } from "./lib/execution-merge.mjs";
import {
  checkActualResults,
  checkAgainstSummary,
  checkObservationRun,
  checkRows,
  checkSingleVersion,
} from "./lib/execution-checks.mjs";
import { compareRows } from "./lib/executions.mjs";
import { readRun } from "./lib/run-reader.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["prune-other-versions", "dry-run"] });
const root = resolve(args.root ?? ".");
const nowIso = new Date().toISOString();
const report = createReport();

function ensureRunDir() {
  const id = args.run;
  if (!id) throw new Error("--run <run-id> が必要");
  const dir = join(root, EVIDENCE_DIR, "runs", String(id));
  if (args.artifacts || !existsSync(dir)) {
    const fetchArgs = ["scripts/evidence/fetch-run.mjs", "--run", String(id), "--root", root];
    if (args.artifacts) fetchArgs.push("--from", args.artifacts);
    if (args.repo) fetchArgs.push("--repo", args.repo);
    const r = spawnSync(process.execPath, fetchArgs, { cwd: root, stdio: "inherit" });
    if (r.status !== 0) throw new Error("fetch-run.mjs に失敗した");
  }
  return dir;
}

function runContext(run, runDir) {
  const { source, summary, selection } = run;
  if (!source || !summary)
    throw new Error(`${runDir} に SOURCE.json / ci-summary.json が無い（fetch-run.mjs で取り込む）`);
  if (summary.commit_sha !== source.head_sha)
    report.error("SOURCE.json と ci-summary.json の対象 SHA が違う");
  return {
    runId: source.run_id,
    runRef: `gh-run-${source.run_id}`,
    sha: source.head_sha,
    kind: source.event === "pull_request" ? "automated" : "regression",
    executor: source.workflow ? "GitHub Actions" : "local",
    startedAt: source.run_started_at,
    capturedAt: source.captured_at,
    selection,
    retestDue: args["retest-due"],
  };
}

// 修正 commit が対象版に含まれるか（git の祖先か）。確かめられないとき（履歴が無い環境）は含まれないものとして、修正確認の接続をしない
const includedIn = (sha) => (fix) =>
  spawnSync("git", ["merge-base", "--is-ancestor", fix, sha], { cwd: root }).status === 0;

const registry = createRegistry(loadEvidenceRows(root));
const runDir = ensureRunDir();
const run = readRun(runDir);
const base = runContext(run, runDir);
const testCases = loadCases(root);
const ctx = {
  ...base,
  testCases,
  junitCases: run.junit.cases,
  junitShas: run.junit.shas,
  observations: run.observations,
  manual: loadManualPlan(root),
  gaps: loadKnownGaps(root, nowIso.slice(0, 10)).gaps,
  defectsByTc: openDefectsByCase(root),
  verifiedByTc: verifiedDefectsByCase(root, includedIn(base.sha)),
  report,
};

const built = buildRunRows(ctx).sort(compareRows);
// 証拠索引の EV は、行の並び（TC → 層 → 環境）の順に採番する（ID の並びと行の並びを揃える）
for (const row of built) row.evidence_ids = (row._evidence ?? []).map((e) => registry.allocate(e)).join(";");
const merged = mergeRows({
  existing: loadExecutions(root),
  built,
  runRef: base.runRef,
  prune: Boolean(args["prune-other-versions"]),
  report,
});
const rows = assignIds(merged);

checkAgainstSummary(run.junit.cases, run.summary, report);
checkObservationRun(run.observations, base, report);
checkActualResults(
  rows.filter((r) => r.run_ref === base.runRef),
  testCases,
  report,
);
checkSingleVersion(rows, report, args.release);
checkRows(
  rows,
  {
    caseIds: new Set(testCases.map((c) => c.test_case_id)),
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
const count = (status) => rows.filter((r) => r.status === status && r.run_ref === base.runRef).length;
process.stdout.write(
  `executions.csv: ${rows.length} 行（この run ${rows.filter((r) => r.run_ref === base.runRef).length} 行: pass ${count("pass")} / fail ${count("fail")} / not_run ${count("not_run")} / skipped ${count("skipped")}）対象 SHA ${base.sha}\n`,
);
