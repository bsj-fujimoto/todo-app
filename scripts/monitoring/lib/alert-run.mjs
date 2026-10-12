// アラートの実行（Issue の作成・追記・close・エスカレーション）。gh の操作は ctx.gh、時刻は ctx.nowMs として受け取る。
import {
  DRILL_LABEL,
  INCIDENT_LABEL,
  decideActions,
  dueEscalations,
  indexOpenIssues,
  issueBody,
  issueTitle,
  ongoingComment,
  recoveryComment,
  routeFor,
} from "./alert-core.mjs";

const labelsFor = (drill) => (drill ? [INCIDENT_LABEL, DRILL_LABEL] : [INCIDENT_LABEL]);
const iso = (ms) => new Date(ms).toISOString();

async function createIncident(ctx, result) {
  const { gh, routes, run, drill, owner, marker, runbooks } = ctx;
  const route = routeFor(routes, result.monitor_id);
  const rb = (runbooks.runbooks || []).find((r) => r.monitor_ids.includes(result.monitor_id));
  const enriched = { ...result, runbook: rb ? rb.path : null };
  const body = issueBody({
    result: enriched,
    run,
    route,
    owner,
    marker,
    deploymentText: ctx.deploymentText,
    drill,
  });
  const issue = await gh.createIssue({
    title: issueTitle(result, drill),
    body,
    labels: labelsFor(drill),
    assignee: owner,
  });
  return {
    kind: "created",
    monitor_id: result.monitor_id,
    severity: result.severity,
    issue,
    at: iso(ctx.nowMs()),
  };
}

async function commentIncident(ctx, action) {
  await ctx.gh.comment(action.issue.number, ongoingComment(action.result, ctx.run));
  return {
    kind: "commented",
    monitor_id: action.result.monitor_id,
    severity: action.result.severity,
    issue: action.issue,
    at: iso(ctx.nowMs()),
  };
}

async function recoverIncident(ctx, action) {
  const downMin = (Date.parse(action.result.at) - Date.parse(action.issue.createdAt)) / 60000;
  await ctx.gh.comment(action.issue.number, recoveryComment(action.result, ctx.run, downMin));
  await ctx.gh.close(action.issue.number);
  return {
    kind: "recovered",
    monitor_id: action.result.monitor_id,
    issue: action.issue,
    at: iso(ctx.nowMs()),
  };
}

const HANDLERS = {
  create: (ctx, a) => createIncident(ctx, a.result),
  comment: commentIncident,
  recover: recoverIncident,
  suppressed: async (ctx, a) => ({
    kind: "suppressed",
    monitor_id: a.result.monitor_id,
    reason: a.result.suppression_reason,
    at: iso(ctx.nowMs()),
  }),
};

// 結果から Issue を操作する。返り値は発生したイベント（alert-history.jsonl に残す）
export async function processResults(ctx, results) {
  // 一覧は検索の索引を使うため、作った直後の Issue はまだ載らないことがある（GitHub Actions の drill で、失敗フェーズの直後に回復フェーズを
  // 呼ぶと #45 が載らず回復できなかった）。番号が分かっている Issue（drill-state.json）は ctx.knownOpen として足す
  const listed = await ctx.gh.listOpenIncidents();
  const known = (ctx.knownOpen || []).filter((k) => !listed.some((l) => l.number === k.number));
  const open = indexOpenIssues([...listed, ...known], ctx.drill);
  const events = [];
  for (const action of decideActions(results, open)) events.push(await HANDLERS[action.kind](ctx, action));
  return events;
}

// 未 ack の open な incident（drill 以外）に、経過時間に応じてリマインドとラベルを付ける
export async function escalate(ctx) {
  const events = [];
  const issues = indexOpenIssues(await ctx.gh.listOpenIncidents(), false);
  for (const [monitorId, issue] of issues) {
    const route = routeFor(ctx.routes, monitorId);
    for (const rule of dueEscalations(route, issue, ctx.nowMs(), ctx.botLogins)) {
      const label = rule.after_hours >= route.ack_target_hours ? "ack-overdue" : "escalated";
      await ctx.gh.comment(
        issue.number,
        `ack が ${rule.after_hours} 時間を超えて確認できません。${rule.action}。\n`,
      );
      await ctx.gh.addLabel(issue.number, label);
      events.push({ kind: "escalated", monitor_id: monitorId, issue, label, at: iso(ctx.nowMs()) });
    }
  }
  return events;
}

// 通知試験（drill）の記録。ack は「assignee（メンテナ）が設定されていることの確認」（自動では人の ack を観測できない）
export async function verifyDrillIssue(ctx, created) {
  const view = await ctx.gh.viewIssue(created.issue.number);
  const assignees = (view.assignees || []).map((a) => a.login);
  const labels = (view.labels || []).map((l) => l.name);
  const ackAt = ctx.nowMs();
  return {
    issue: { number: created.issue.number, url: created.issue.url },
    notified_at: view.createdAt,
    assignee_expected: ctx.owner,
    assignee_verified: assignees.includes(ctx.owner),
    labels_ok: labelsFor(true).every((l) => labels.includes(l)),
    ack_method: "assignee-verified（assignee 設定の確認。人が通知を受け取ったかは観測できない）",
    ack_at: iso(ackAt),
    ack_seconds: Math.round((ackAt - Date.parse(view.createdAt)) / 1000),
  };
}
