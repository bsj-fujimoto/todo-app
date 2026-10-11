#!/usr/bin/env node
// GitHub Issue（label: defect と flaky）から docs/data/defects.csv を生成する。
//   node scripts/evidence/build-defects.mjs              # gh で取得し、スナップショット（docs/evidence/github/defect-issues.json）を更新
//   node scripts/evidence/build-defects.mjs --offline    # コミット済みのスナップショットだけで再生成（gh 不要。冪等）
// Issue 本文は .github/ISSUE_TEMPLATE/defect.md の見出しと「- キー: 値」を読む。欠けた項目があれば、その Issue 番号と項目を示して失敗する
// （事実に基づいて Issue 本文を補筆してから再実行する）。取得した内容が変わらなければスナップショットは書き換えない。
// composition root: 時刻・gh・git・ファイル入出力をここで束ねる。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { createReport, readJson, sha256, writeJson } from "./lib/common.mjs";
import { loadCases, loadEvidenceRows, loadExecutions, writeTable, saveEvidenceRows } from "./lib/data-io.mjs";
import { DEFECT_COLUMNS, buildDefect, checkDefectRows, selectIssues } from "./lib/defects.mjs";
import { createRegistry } from "./lib/evidence-registry.mjs";
import { SNAPSHOT_FILE, buildSnapshot, fixPrNumbers, sameContent } from "./lib/github-snapshot.mjs";
import { issueEvidence } from "./lib/defect-evidence.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["offline"] });
const root = resolve(args.root ?? ".");
const nowIso = new Date().toISOString();
const report = createReport();
const snapshotPath = join(root, SNAPSHOT_FILE);
const sourcePath = join(dirname(snapshotPath), "SOURCE.json");

const run = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} に失敗: ${r.stderr}`);
  return r.stdout;
};

function repository() {
  return args.repo ?? JSON.parse(run("gh", ["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
}

function fetchIssues() {
  const fields = "number,title,state,stateReason,body,labels,createdAt,closedAt,comments,url";
  const lists = ["defect", "flaky"].map((label) =>
    JSON.parse(
      run("gh", ["issue", "list", "--label", label, "--state", "all", "--limit", "500", "--json", fields]),
    ),
  );
  return selectIssues(lists.flat());
}

function fetchFixPrs(issues) {
  const out = {};
  for (const n of fixPrNumbers(issues)) {
    const pr = JSON.parse(run("gh", ["pr", "view", n, "--json", "state,mergeCommit,mergedAt"]));
    if (pr.state === "MERGED") out[n] = { merge_commit: pr.mergeCommit.oid, merged_at: pr.mergedAt };
  }
  return out;
}

function fetchReleases() {
  const text = run("git", ["tag", "--list", "v*", "--format", "%(refname:short) %(creatordate:iso-strict)"]);
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => ({ tag: l.split(" ")[0], date: new Date(l.split(" ")[1]).toISOString() }));
}

function loadSnapshot() {
  const committed = existsSync(snapshotPath) ? readJson(snapshotPath) : null;
  if (args.offline) {
    if (!committed) throw new Error(`${SNAPSHOT_FILE} が無い（--offline では先に gh で取得しておく）`);
    return committed;
  }
  const issues = fetchIssues();
  const fresh = buildSnapshot({
    repository: repository(),
    issues,
    fixPrs: fetchFixPrs(issues),
    releases: fetchReleases(),
  });
  if (sameContent(committed, fresh)) return committed;
  writeJson(snapshotPath, fresh);
  writeJson(sourcePath, {
    schema_version: 1,
    kind: "github",
    captured_at: nowIso,
    source_url: `https://github.com/${fresh.repository}/issues?q=is%3Aissue+label%3Adefect%2Cflaky`,
    head_sha: args["head-sha"] ?? run("git", ["rev-parse", "HEAD"]).trim(),
    version: "pre-1.0.0",
    collected_by: "scripts/evidence/build-defects.mjs",
  });
  return fresh;
}

const snapshot = loadSnapshot();
const source = readJson(sourcePath);
const registry = createRegistry(loadEvidenceRows(root));
const executions = loadExecutions(root);
const fixCommits = new Map(Object.entries(snapshot.fix_prs).map(([n, v]) => [n, v.merge_commit]));
const ctx = {
  releases: snapshot.releases,
  fixCommits,
  caseIds: new Set(loadCases(root).map((c) => c.test_case_id)),
  evidence: (issue, fields) =>
    issueEvidence({
      issue,
      fields,
      registry,
      executions,
      snapshotSha: sha256(readFileSync(snapshotPath)),
      source,
    }),
};

const rows = [];
for (const issue of snapshot.issues) {
  const built = buildDefect(issue, ctx);
  rows.push(built.row);
  for (const p of built.problems) report.error(p);
}
checkDefectRows(rows, report);

if (!report.ok) {
  for (const e of report.errors) process.stderr.write(`エラー: ${e}\n`);
  process.exit(1);
}
writeTable(root, "defects", DEFECT_COLUMNS, rows);
saveEvidenceRows(root, registry.rows());
const count = (key) =>
  Object.entries(Object.groupBy(rows, (r) => r[key]))
    .map(([k, v]) => `${k} ${v.length}`)
    .join(" / ");
process.stdout.write(
  `defects.csv: ${rows.length} 件（状態 ${count("status")}、重大度 ${count("severity")}）\n`,
);
