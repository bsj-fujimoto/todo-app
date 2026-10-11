// ベースライン比較（CLI）。perf/baseline.json の最新エントリ（--release で指定可）と、今回の metrics.json を同じ指標名で比較し、
// 退行（既定 +20% 超。perf/regression-threshold.yaml）があれば終了コード 1 で失敗する。
// 使い方: node scripts/perf/compare.mjs --run-dir perf/results/<run_id> [--baseline perf/baseline.json] [--threshold perf/regression-threshold.yaml]
// 基準の更新: node scripts/perf/compare.mjs --run-dir <dir> --update-baseline --release <タグ>（release ごとに実行し、PR で差分をレビューする）
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { parseArgs, requireArg } from "../lib/cli.mjs";
import { compareAll } from "./lib/compare-rules.mjs";

const read = async (p) => JSON.parse(await readFile(p, "utf8"));

function render(result, release) {
  const lines = [
    `[compare] 基準 ${release}: 比較 ${result.compared} 指標、退行 ${result.regressions.length} 件`,
  ];
  for (const r of result.regressions) {
    lines.push(
      `  REGRESSION ${r.key}: ${r.baseline} → ${r.current}（${r.change_pct}% 悪化 > ${r.threshold_pct}%）`,
    );
  }
  if (result.only_in_baseline.length)
    lines.push(`  今回測っていない基準の指標: ${result.only_in_baseline.join(", ")}`);
  return lines.join("\n");
}

async function updateBaseline(args, ctx) {
  const { baselinePath, baseline, current } = ctx;
  const entry = {
    release: requireArg(args, "release"),
    commit_sha: current.commit_sha,
    run_id: current.run_id,
    measured_at: current.started_at,
    environment: current.environment,
    metrics: current.metrics,
  };
  baseline.baselines.push(entry);
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`[compare] ${baselinePath} に ${entry.release} を追加（run ${current.run_id}）`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = requireArg(args, "run-dir");
  const baselinePath = args.baseline || "perf/baseline.json";
  const cfg = parse(await readFile(args.threshold || "perf/regression-threshold.yaml", "utf8"));
  const baseline = await read(baselinePath);
  const current = await read(join(runDir, "metrics.json"));
  if (args["update-baseline"]) return updateBaseline(args, { baselinePath, baseline, current });
  const entry = args.release
    ? baseline.baselines.find((b) => b.release === args.release)
    : baseline.baselines.at(-1);
  if (!entry) throw new Error("基準（perf/baseline.json の baselines）が無い");
  const result = compareAll(entry.metrics, current.metrics, cfg);
  await writeFile(
    join(runDir, "compare.json"),
    `${JSON.stringify({ baseline: entry.release, config: cfg, ...result }, null, 1)}\n`,
  );
  console.log(render(result, entry.release));
  process.exit(result.regressions.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
