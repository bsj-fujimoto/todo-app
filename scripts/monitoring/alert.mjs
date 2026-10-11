// アラート（CLI, composition root）。run-monitors.mjs の results.json を読み、gh CLI で GitHub Issue を操作する。
//   失敗 → incident Issue を作成（既に open な同じ monitor の Issue があればコメント追記）。assignee は CODEOWNERS の既定の所有者。
//   回復 → 回復のコメントを書いて close。抑制された失敗は通知しない。
//   --escalate: 未 ack の open な incident に、経過時間に応じてリマインドとラベルを付ける。
//   --drill: 通知試験。Issue は drill ラベル付き・タイトルに [drill]。--drill-phase fail → recover の順に呼ぶと alert-test.json を出す。
// 使い方: node scripts/monitoring/alert.mjs --results monitoring/out/results.json --out monitoring/out [--repo owner/name] [--run-url URL]
//         [--drill --drill-phase fail|recover] [--escalate] [--dry-run]
// 権限: issues: write が必要（ワークフローではこのジョブだけに付ける）。他のジョブは contents: read。
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { parseArgs, requireArg } from "../lib/cli.mjs";
import { defaultOwner } from "./lib/alert-core.mjs";
import { escalate, processResults, verifyDrillIssue } from "./lib/alert-run.mjs";
import { buildDrillRecord, renderDrillMarkdown } from "./lib/drill-record.mjs";
import { makeGh } from "./gh-client.mjs";

const readYaml = (p) => parse(readFileSync(p, "utf8"));

function latestMarker(path) {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

function buildCtx(args, out) {
  const routes = readYaml("monitoring/alert-routes.yaml");
  const repo = args.repo || process.env.GITHUB_REPOSITORY || routes.notification.repository;
  const owner = defaultOwner(readFileSync(".github/CODEOWNERS", "utf8"));
  return {
    gh: makeGh(repo, Boolean(args["dry-run"])),
    routes,
    runbooks: readYaml("monitoring/runbooks/index.yaml"),
    owner,
    drill: Boolean(args.drill),
    marker: latestMarker(args.markers || join(out, "deployment-markers.jsonl")),
    botLogins: ["github-actions", "app/github-actions"],
    nowMs: () => Date.now(),
    repo,
  };
}

function recordEvents(out, events, drill) {
  for (const e of events) {
    const row = {
      monitor_id: e.monitor_id,
      at: e.at,
      kind: e.kind,
      severity: e.severity || null,
      acknowledged_at: null,
      in_maintenance: false,
      issue: e.issue ? e.issue.number : null,
      drill,
    };
    appendFileSync(join(out, "alert-history.jsonl"), `${JSON.stringify(row)}\n`);
    console.log(
      `[alert] ${e.kind} ${e.monitor_id}${e.issue ? ` #${e.issue.number}` : ""}${e.reason ? ` (${e.reason})` : ""}`,
    );
  }
}

async function drillFail(ctx, events, results, out) {
  const created = events.filter((e) => e.kind === "created");
  const checks = [];
  for (const c of created) checks.push({ monitor_id: c.monitor_id, ...(await verifyDrillIssue(ctx, c)) });
  const failing = results.results.filter((r) => r.result === "fail");
  const state = {
    test_id: `drill-${results.run.run_id}`,
    detected_at: failing.length ? failing[0].at : results.run.started_at,
    issues: checks,
    run: results.run,
  };
  writeFileSync(join(out, "drill-state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

async function drillRecover(ctx, events, results, out) {
  const state = JSON.parse(readFileSync(join(out, "drill-state.json"), "utf8"));
  const closed = [];
  for (const e of events.filter((x) => x.kind === "recovered"))
    closed.push({
      monitor_id: e.monitor_id,
      number: e.issue.number,
      state: (await ctx.gh.viewIssue(e.issue.number)).state,
    });
  const record = buildDrillRecord(state, {
    recovered_at: results.run.started_at,
    closed,
    recoveryRun: results.run,
    repo: ctx.repo,
  });
  writeFileSync(join(out, "alert-test.json"), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(out, "alert-test.md"), renderDrillMarkdown(record));
  appendFileSync(join(out, "alert-tests.jsonl"), `${JSON.stringify(record)}\n`);
  console.log(
    `[drill] result=${record.result} notify=${record.notify_latency_sec}s ack=${record.ack_seconds}s`,
  );
  if (record.result !== "pass") process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out || "monitoring/out";
  const ctx = buildCtx(args, out);
  const results = JSON.parse(readFileSync(requireArg(args, "results"), "utf8"));
  ctx.run = { ...results.run, run_url: args["run-url"] || null };
  await ctx.gh.ensureLabels();
  const events = await processResults(ctx, results.results);
  if (args.escalate) events.push(...(await escalate(ctx)));
  recordEvents(out, events, ctx.drill);
  if (args["drill-phase"] === "fail") await drillFail(ctx, events, results, out);
  if (args["drill-phase"] === "recover") await drillRecover(ctx, events, results, out);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
