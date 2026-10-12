// schedule の実行間隔の実測（CLI, composition root）。宣言（.github/workflows の cron）と実測（Actions の実行履歴）を並べる。
// gh api の読み取りのみ（GET）。Issue・ワークフローには何も書かない。
// 出力: 標準出力に表、--out <dir> を付けると cadence.json と cadence.md を書く。
// 使い方: node scripts/monitoring/cadence.mjs [--repo owner/name] [--workflows synthetic.yml,nightly.yml,monitoring-watchdog.yml]
//                                          [--out monitoring/cadence] [--stamp 20261012T0800Z] [--json]
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { parseArgs } from "../lib/cli.mjs";
import { recommendThresholdHours, renderMarkdown, summarizeWorkflow } from "./lib/cadence.mjs";

const exec = promisify(execFile);
const DEFAULT_WORKFLOWS = ["synthetic.yml", "nightly.yml", "monitoring-watchdog.yml"];
const SUMMARY_WORKFLOW = "synthetic.yml";

// gh api --paginate --jq で 1 行 1 JSON にして読む（ページをまたいでも連結される）
async function ghLines(path, jq) {
  const { stdout } = await exec("gh", ["api", "--paginate", path, "--jq", jq], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function fetchRuns(repo, file) {
  const jq = ".workflow_runs[] | {id, created_at, event, status, conclusion, html_url}";
  return ghLines(`repos/${repo}/actions/workflows/${file}/runs?per_page=100`, jq);
}

// schedule が有効になった時刻 = 既定ブランチにこのワークフローが最初に入ったコミットの日時
async function enabledAt(repo, file) {
  const commits = await ghLines(
    `repos/${repo}/commits?path=.github/workflows/${file}&per_page=100`,
    ".[] | {date: .commit.committer.date}",
  );
  return commits.length ? commits[commits.length - 1].date : null;
}

function declaredCrons(file) {
  const doc = parse(readFileSync(`.github/workflows/${file}`, "utf8"));
  return ((doc.on || doc[true] || {}).schedule || []).map((s) => s.cron);
}

async function collect(repo, file, nowMs) {
  const [runs, windowStartIso] = await Promise.all([fetchRuns(repo, file), enabledAt(repo, file)]);
  return summarizeWorkflow({ file, crons: declaredCrons(file), runs, windowStartIso, nowMs });
}

function write(out, stamp, report, markdown) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `cadence-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, `cadence-${stamp}.md`), `${markdown}\n`);
}

function recommend(workflows) {
  const base = workflows.find((w) => w.file === SUMMARY_WORKFLOW) || workflows[0];
  const stats = base.schedule.interval_stats_sec;
  return { workflow: base.file, max_interval_sec: stats.max, ...recommendThresholdHours(stats.max, stats.n) };
}

function output(args, report, markdown) {
  if (args.out) {
    const stamp = args.stamp || report.generated_at.replace(/[-:]/g, "").slice(0, 13) + "Z";
    write(args.out, stamp, report, markdown);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  console.log(args.json ? JSON.stringify(report, null, 2) : markdown);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || process.env.GITHUB_REPOSITORY || "bsj-fujimoto/todo-app";
  const files = args.workflows ? String(args.workflows).split(",") : DEFAULT_WORKFLOWS;
  const nowMs = Date.now();
  const workflows = await Promise.all(files.map((f) => collect(repo, f, nowMs)));
  const recommendation = recommend(workflows);
  const generatedAt = new Date(nowMs).toISOString();
  const report = { generated_at: generatedAt, repo, workflows, recommendation };
  output(args, report, renderMarkdown({ generatedAt, repo, workflows, recommendation }));
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
