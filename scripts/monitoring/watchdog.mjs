// 監視の死活監視（CLI, composition root）。synthetic.yml の最終実行の時刻を確かめ、しきい値より古ければ stale を出力する。
// しきい値は monitoring/monitors.yaml の watchdog.threshold_hours（実測の実効間隔から決めた値）。--hours で上書きできる。
// 出力: 標準出力と $GITHUB_OUTPUT（stale=true|false、detail=…、title=…）。stale のときの Issue 起票は alert.mjs --meta fail（monitoring-watchdog.yml）。
// 使い方: node scripts/monitoring/watchdog.mjs [--repo owner/name] [--hours 8]
import { execFile } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { parse } from "yaml";
import { parseArgs } from "../lib/cli.mjs";
import { lastRanRun, staleTitle, staleness } from "./lib/watchdog.mjs";

const exec = promisify(execFile);

// 直近 20 件から、実際に動いた run（skipped / cancelled を除く）の最新を取る
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
    "20",
    "--json",
    fields,
  ];
  return lastRanRun(JSON.parse((await exec("gh", args)).stdout));
}

function thresholdHours(args) {
  if (args.hours) return Number(args.hours);
  return Number(parse(readFileSync("monitoring/monitors.yaml", "utf8")).watchdog.threshold_hours);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || process.env.GITHUB_REPOSITORY || "bsj-fujimoto/todo-app";
  const run = await lastRun(repo);
  const lastCreatedAt = run ? run.createdAt : null;
  const hours = thresholdHours(args);
  const result = staleness({ lastCreatedAt, nowMs: Date.now(), thresholdHours: hours });
  console.log(`[watchdog] stale=${result.stale} ${result.detail}`);
  if (process.env.GITHUB_OUTPUT) {
    const lines = `stale=${result.stale}\ndetail=${result.detail}\ntitle=${staleTitle(hours)}\n`;
    appendFileSync(process.env.GITHUB_OUTPUT, lines);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
