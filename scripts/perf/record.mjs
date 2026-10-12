// 記録の仕上げ（CLI）。verdict.mjs の後に実行する。
//   metrics.json   : ベースライン比較（compare.mjs）に使う指標（<シナリオ>.<指標名> → 値）
//   perf-runs.json : シナリオごとの記録（qc-analyzer の PerfRun と同じ項目: tool・版・script/設定の sha・commit・warm-up・反復・分散・判定規則 ほか）
//   manifest.json  : 結果ディレクトリの全ファイルの sha256。巨大な生ログ（*.raw.json.gz・observe.jsonl）はコミットせず、ここで追跡する
// 使い方: node scripts/perf/record.mjs --run-dir perf/results/<run_id>
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { parseArgs, requireArg } from "../lib/cli.mjs";
import { flattenMetrics } from "./lib/metrics.mjs";
import { comparisonInfo } from "./lib/compare-rules.mjs";
import { buildRuns, environmentLabel } from "./lib/record-build.mjs";

const SCENARIOS = ["load", "stress", "spike", "soak", "capacity", "screen"];
const UNCOMMITTED = [/\.raw\.json\.gz$/, /observe\.jsonl$/];
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, obj) => writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function manifest(runDir) {
  const files = walk(runDir)
    .filter((f) => !f.endsWith("manifest.json"))
    .sort()
    .map((f) => {
      const data = readFileSync(f); // 1 回だけ読む（stat と read の間にファイルが変わる競合を避ける）
      return {
        path: relative(runDir, f),
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        committed: !UNCOMMITTED.some((re) => re.test(f)),
      };
    });
  return { run_dir: runDir, files };
}

function loadAnalyses(runDir, scenarios) {
  const out = {};
  for (const sc of scenarios) {
    const dir = join(runDir, sc);
    const iters = readdirSync(dir)
      .filter((n) => /^iter-\d+$/.test(n))
      .sort();
    out[sc] = iters.map((n) => readJson(join(dir, n, "analysis.json")));
  }
  return out;
}

// 画面計測は反復ディレクトリを持たず、サーバ観測の分析は screen/analysis.json の 1 件（verdict.mjs が書く）
function loadScreenAnalysis(runDir) {
  const p = join(runDir, "screen", "analysis.json");
  return existsSync(p) ? [readJson(p)] : [];
}

// この run を比べる基準（同じ env_class のもの）。baseline.json が無ければ null
function comparisonOf(run) {
  const path = "perf/baseline.json";
  return existsSync(path) ? comparisonInfo(readJson(path).baselines, run.env_class) : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = requireArg(args, "run-dir");
  const run = readJson(join(runDir, "run.json"));
  const verdicts = SCENARIOS.map((s) => join(runDir, s, "verdict.json"))
    .filter((p) => existsSync(p))
    .map(readJson);
  const analyses = loadAnalyses(
    runDir,
    verdicts.map((v) => v.scenario).filter((s) => s !== "screen"),
  );
  if (verdicts.some((v) => v.scenario === "screen")) analyses.screen = loadScreenAnalysis(runDir);
  const metrics = flattenMetrics(verdicts);
  const envDoc = parse(readFileSync("perf/environment.yaml", "utf8"));
  const head = {
    run_id: run.run_id,
    commit_sha: run.commit_sha,
    started_at: run.started_at,
    env_class: run.env_class,
  };
  writeJson(join(runDir, "metrics.json"), { ...head, environment: environmentLabel(run), metrics });
  writeJson(
    join(runDir, "perf-runs.json"),
    buildRuns({ run, envDoc, metrics, analyses, comparison: comparisonOf(run) }, verdicts),
  );
  writeJson(join(runDir, "manifest.json"), manifest(runDir));
  console.log(
    `[record] ${run.run_id}: metrics ${Object.keys(metrics).length} 件、記録 ${verdicts.length} 件`,
  );
}

main();
