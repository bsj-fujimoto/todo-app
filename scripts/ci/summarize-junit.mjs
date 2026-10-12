#!/usr/bin/env node
// JUnit XML 群 → ci-summary.json（と $GITHUB_STEP_SUMMARY の表）。依存ゼロ。
//   層ごと : node scripts/ci/summarize-junit.mjs --layer unit=backend/test-results --out ci-summary-unit.json
//   カバレッジを載せる: --coverage backend=backend/test-results/coverage-summary.json（coverage-summary.mjs の出力）
//   集約   : node scripts/ci/summarize-junit.mjs --merge <summaries のディレクトリ> --out ci-summary.json --job lint=success [--jobs-json run-jobs.json]
//            環境変数 RUN_STARTED_AT（run の開始時刻。REST API の run_started_at）で run 全体の所要（run_duration_sec）、--jobs-json（run のジョブ一覧）で層ごとの所要を実測にする
//   consumer contract: --consumer-contract backend/test-results/consumer-contract.json（検証結果。ci-summary の consumer_contracts に載る）
// composition root: 時刻・環境変数・ファイルをここで束ねる（純粋なロジックは lib/ に置く）。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { asList, parseArgs } from "./lib/args.mjs";
import { describeArtifact } from "./lib/artifacts.mjs";
import { readJunitFiles } from "./lib/junit.mjs";
import { listJsonFiles, readConsumerContracts, readCoverageSpecs, readSummaries } from "./lib/summary-io.mjs";
import { buildSummary, mergeSummaries, renderMarkdown } from "./lib/summary.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["strict"] });
const nowIso = new Date().toISOString();
const readJsonOr = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
};

function layerSpecs() {
  return asList(args.layer).map((spec) => {
    const [layer, paths] = spec.split("=");
    const { files, cases } = readJunitFiles(paths.split(","));
    return { layer, files, cases };
  });
}

function build() {
  if (args.merge) {
    // NEEDS_JSON: workflow の `toJSON(needs)`。--job name=result でも指定できる。
    const needs = JSON.parse(process.env.NEEDS_JSON || "{}");
    const jobResults = {
      ...Object.fromEntries(Object.entries(needs).map(([k, v]) => [k, v.result])),
      ...Object.fromEntries(asList(args.job).map((j) => j.split("="))),
    };
    const summaries = readSummaries(listJsonFiles(args.merge));
    // --jobs-json: GitHub API の run のジョブ一覧（無い・読めなければ空。層ごとの所要は JUnit のテスト時間のままになる）
    const jobs = args["jobs-json"] && existsSync(args["jobs-json"]) ? readJsonOr(args["jobs-json"], []) : [];
    return mergeSummaries({ env: process.env, nowIso, summaries, jobResults, jobs });
  }
  const artifacts = asList(args.artifact).map(describeArtifact);
  // --consumer-contract <結果 JSON>: consumer contract の検証結果。verified_at は検証直後のこの時刻、対象 SHA は TARGET_SHA
  const commitSha = process.env.TARGET_SHA || process.env.GITHUB_SHA;
  const consumerContracts = readConsumerContracts(asList(args["consumer-contract"]), { nowIso, commitSha });
  const summary = buildSummary({
    env: process.env,
    nowIso,
    layerSpecs: layerSpecs(),
    artifacts,
    consumerContracts,
  });
  return { ...summary, coverage: readCoverageSpecs(asList(args.coverage)) };
}

const summary = build();
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`);
const md = renderMarkdown(summary, args.title ?? "CI サマリ");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
process.stdout.write(md);
// --strict: 指定した層に 1 件もテスト結果が無ければ失敗（「走っていない」を成功にしない）
if (args.strict && Object.values(summary.layers).every((l) => l.total === 0)) process.exitCode = 1;
