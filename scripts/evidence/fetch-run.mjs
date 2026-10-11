#!/usr/bin/env node
// CI run の成果物を docs/evidence/ へ取り込む（小さな実行成果物だけ。巨大な trace / video は持ち込まない）。
//   node scripts/evidence/fetch-run.mjs --run <run-id> [--kind ci|security|perf|monitoring|github] [--repo owner/name]
//   node scripts/evidence/fetch-run.mjs --from <gh run download の出力ディレクトリ> --run <id>   # 取得済みの artifact を使う
// kind=ci（既定）: docs/evidence/runs/<run-id>/ を作り直す（再実行しても同じ結果）。ci-summary.json から SOURCE.json を作る。
// それ以外: docs/evidence/<kind>/ を最新の 1 組に置き換える。SOURCE.json に取得時刻・取得元 run の URL・対象 SHA を残す。
// composition root: 時刻・gh・ファイル入出力をここで束ねる。
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { EVIDENCE_DIR, readJson, toPosix, writeJson } from "./lib/common.mjs";
import { KINDS, planKindFiles } from "./lib/kinds.mjs";
import { ownersOf, redactFiles, redactionSection } from "./lib/redact-files.mjs";
import { artifactNames, buildRunSource, planRunFiles, versionOf } from "./lib/run-layout.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const kind = args.kind ?? "ci";
const runId = args.run;
const nowIso = new Date().toISOString();

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [toPosix(p.slice(base.length + 1))];
  });
}

// artifact を 1 つずつ取る（*.dockerbuild は zip でなく、まとめて取ると他の artifact を取る前に止まるため除く）。
function download() {
  const dir = mkdtempSync(join(tmpdir(), "evidence-run-"));
  const repoArgs = args.repo ? ["--repo", args.repo] : [];
  const repoPath = args.repo ?? "{owner}/{repo}";
  const list = spawnSync(
    "gh",
    [
      "api",
      `repos/${repoPath}/actions/runs/${runId}/artifacts`,
      "--paginate",
      "--jq",
      ".artifacts[] | select(.expired | not) | .name",
    ],
    { encoding: "utf8" },
  );
  if (list.status !== 0) throw new Error(`artifact の一覧を取得できない: ${list.stderr}`);
  for (const name of list.stdout.split("\n").filter((n) => n && !n.endsWith(".dockerbuild"))) {
    const r = spawnSync(
      "gh",
      ["run", "download", String(runId), ...repoArgs, "-n", name, "-D", join(dir, name)],
      { encoding: "utf8" },
    );
    if (r.status !== 0) process.stderr.write(`警告: artifact ${name} を取得できない: ${r.stderr.trim()}\n`);
  }
  return dir;
}

function copyPlan(rawDir, plan, destDir) {
  for (const { from, to } of plan) {
    const target = join(destDir, to);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(rawDir, from), target);
  }
}

function fetchCi(rawDir, files) {
  const plan = planRunFiles(files);
  if (!plan.some((p) => p.to === "ci-summary.json"))
    throw new Error("ci-summary.json が無い（ci-summary artifact が取れていない）");
  const summary = readJson(join(rawDir, plan.find((p) => p.to === "ci-summary.json").from));
  const dest = join(root, EVIDENCE_DIR, "runs", String(summary.run_id));
  rmSync(dest, { recursive: true, force: true });
  copyPlan(rawDir, plan, dest);
  const records = redactFiles(
    dest,
    plan.map((p) => p.to),
    ownersOf(summary.repository ?? args.repo),
  );
  const version = args.version ?? versionOf(summary.ref);
  writeJson(join(dest, "SOURCE.json"), {
    ...buildRunSource({ summary, nowIso, names: artifactNames(files), version, repository: args.repo }),
    ...redactionSection(records),
  });
  return { dest, count: plan.length, sha: summary.commit_sha };
}

function runView() {
  if (args.sha && args.url) return { headSha: args.sha, url: args.url };
  const repoArgs = args.repo ? ["--repo", args.repo] : [];
  const out = spawnSync(
    "gh",
    ["run", "view", String(runId), ...repoArgs, "--json", "headSha,url,workflowName,event"],
    { encoding: "utf8" },
  );
  if (out.status !== 0)
    throw new Error(`gh run view に失敗: ${out.stderr}（--sha と --url を渡すと gh なしで進める）`);
  return JSON.parse(out.stdout);
}

function fetchKind(rawDir, files) {
  const sizeOf = (rel) => statSync(join(rawDir, rel)).size;
  const { plan, skipped } = planKindFiles(kind, files, sizeOf);
  if (plan.length === 0)
    throw new Error(
      `${kind} の取り込み対象が無い（artifact 名・ファイル名の規則: scripts/evidence/lib/kinds.mjs）`,
    );
  const dest = join(root, EVIDENCE_DIR, KINDS[kind].dir);
  rmSync(dest, { recursive: true, force: true });
  copyPlan(rawDir, plan, dest);
  const view = runView();
  const records = redactFiles(
    dest,
    plan.map((p) => p.to),
    ownersOf(view.url),
  );
  writeJson(join(dest, "SOURCE.json"), {
    schema_version: 1,
    kind,
    captured_at: nowIso,
    source_url: view.url,
    head_sha: view.headSha,
    version: args.version ?? "pre-1.0.0",
    run_id: String(runId),
    workflow: view.workflowName ?? null,
    event: view.event ?? null,
    artifacts: artifactNames(files),
    skipped_large_files: skipped,
    ...redactionSection(records),
    collected_by: "scripts/evidence/fetch-run.mjs",
  });
  return { dest, count: plan.length, sha: view.headSha };
}

if (!runId) throw new Error("--run <run-id> が必要");
const rawDir = args.from ? resolve(args.from) : download();
if (!existsSync(rawDir)) throw new Error(`${rawDir} が無い`);
const files = listFiles(rawDir);
const done = kind === "ci" ? fetchCi(rawDir, files) : fetchKind(rawDir, files);
process.stdout.write(`${kind}: ${done.count} ファイルを ${done.dest} へ取り込んだ（対象 SHA ${done.sha}）\n`);
