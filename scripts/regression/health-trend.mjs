#!/usr/bin/env node
// CI / nightly の健全性トレンド（成功率・所要時間・連続失敗・未実行）を直近の run から集計する。
//   node scripts/regression/health-trend.mjs --repo owner/name --workflow ci.yml --workflow nightly.yml --limit 30 --out health-trend.json
// gh（GH_TOKEN）で workflow runs を読む。閾値を超えたら problems に出す（exit 1 は --strict のときだけ）。
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { asList, parseArgs } from "../ci/lib/args.mjs";
import { evaluateHealth, summarizeRuns } from "./lib/health.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["strict"] });
const limit = Number(args.limit ?? 30);
// 所要時間の p95 の上限: PR のフィードバック時間の宣言値（10 分 = 600 秒）を ci.yml に適用する。実測は 2.4〜4.4 分（成功した run）で、十分に余裕がある。
// nightly.yml は全件・全ブラウザ（週次は ×3）を回す層なので、フィードバックではなく完走の上限として 30 分にする。
const limits = {
  min_success_rate: 0.9,
  max_consecutive_failures: 2,
  max_p95_sec: 600,
  per_workflow_p95_sec: { "nightly.yml": 1800 },
};

function fetchRuns(workflow) {
  const path = `repos/${args.repo}/actions/workflows/${workflow}/runs?per_page=${limit}&status=completed`;
  const out = execFileSync("gh", ["api", path, "--jq", ".workflow_runs"], { encoding: "utf8" });
  return JSON.parse(out);
}

// 取得できない workflow（まだ default branch に無い・権限なし）は、取れなかった理由を残して続行する（隠さない）
function summarize(w) {
  try {
    const summary = summarizeRuns(w, fetchRuns(w));
    return { ...summary, problems: evaluateHealth(summary, limits) };
  } catch (e) {
    const empty = summarizeRuns(w, []);
    return { ...empty, error: String(e.message).split("\n")[0], problems: [] };
  }
}

const workflows = asList(args.workflow).map(summarize);
const report = {
  schema_version: 1,
  repository: args.repo,
  generated_at: new Date().toISOString(),
  window_runs: limit,
  limits,
  workflows,
};
mkdirSync(dirname(resolve(args.out)), { recursive: true });
writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);

const rows = workflows.map(
  (w) =>
    `| ${w.workflow} | ${w.runs_observed} | ${w.success_rate ?? "-"} | ${w.duration_sec.median ?? "-"}s | ${w.duration_sec.p95 ?? "-"}s | ${w.consecutive_failures} | ${w.problems.join("; ") || "-"} |`,
);
const md = `### CI 健全性トレンド（直近 ${limit} run）\n\n| workflow | run 数 | 成功率 | 所要 中央値 | p95 | 連続失敗 | 問題 |\n|---|---:|---:|---:|---:|---:|---|\n${rows.join("\n")}\n`;
process.stdout.write(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
process.exitCode = args.strict && workflows.some((w) => w.problems.length) ? 1 : 0;
