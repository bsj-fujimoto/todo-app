// 監視の死活監視（CLI, composition root）。synthetic.yml の最終実行の時刻を確かめ、しきい値（既定 3 時間）より古ければ stale を出力する。
// 出力: 標準出力と $GITHUB_OUTPUT（stale=true|false、detail=…）。stale のときの Issue 起票は alert.mjs --meta fail（monitoring-watchdog.yml）。
// 使い方: node scripts/monitoring/watchdog.mjs [--repo owner/name] [--hours 3]
import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";
import { parseArgs } from "../lib/cli.mjs";
import { staleness } from "./lib/watchdog.mjs";

const exec = promisify(execFile);

async function lastRun(repo) {
  const fields = "createdAt,status,conclusion,url";
  const args = [
    "run",
    "list",
    "--repo",
    repo,
    "--workflow",
    "synthetic.yml",
    "--limit",
    "1",
    "--json",
    fields,
  ];
  const runs = JSON.parse((await exec("gh", args)).stdout);
  return runs.length ? runs[0] : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || process.env.GITHUB_REPOSITORY || "bsj-fujimoto/todo-app";
  const run = await lastRun(repo);
  const lastCreatedAt = run ? run.createdAt : null;
  const result = staleness({ lastCreatedAt, nowMs: Date.now(), thresholdHours: Number(args.hours || 3) });
  console.log(`[watchdog] stale=${result.stale} ${result.detail}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `stale=${result.stale}\ndetail=${result.detail}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
