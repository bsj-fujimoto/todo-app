#!/usr/bin/env node
// JUnit XML 群 → ci-summary.json（と $GITHUB_STEP_SUMMARY の表）。依存ゼロ。
//   層ごと : node scripts/ci/summarize-junit.mjs --layer unit=backend/test-results --out ci-summary-unit.json
//   集約   : node scripts/ci/summarize-junit.mjs --merge <summaries のディレクトリ> --out ci-summary.json --job lint=success
// composition root: 時刻・環境変数・ファイルをここで束ねる（純粋なロジックは lib/ に置く）。
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { asList, parseArgs } from "./lib/args.mjs";
import { describeArtifact } from "./lib/artifacts.mjs";
import { readJunitFiles } from "./lib/junit.mjs";
import { listJsonFiles, readSummaries } from "./lib/summary-io.mjs";
import { buildSummary, mergeSummaries, renderMarkdown } from "./lib/summary.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["strict"] });
const nowIso = new Date().toISOString();

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
    return mergeSummaries({ env: process.env, nowIso, summaries, jobResults });
  }
  const artifacts = asList(args.artifact).map(describeArtifact);
  return buildSummary({ env: process.env, nowIso, layerSpecs: layerSpecs(), artifacts });
}

const summary = build();
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`);
const md = renderMarkdown(summary, args.title ?? "CI サマリ");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
process.stdout.write(md);
// --strict: 指定した層に 1 件もテスト結果が無ければ失敗（「走っていない」を成功にしない）
if (args.strict && Object.values(summary.layers).every((l) => l.total === 0)) process.exitCode = 1;
