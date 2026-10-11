// アラート判断の純関数（Issue の作成・追記・close の決定、本文の組み立て、ack と期限の判定）。gh の呼び出しは alert.mjs。
export const INCIDENT_LABEL = "incident";
export const DRILL_LABEL = "drill";

// .github/CODEOWNERS の既定の所有者（`*` の行の最初の @owner）。on-call ロール（maintainer）の実体
export function defaultOwner(codeowners) {
  for (const line of codeowners.split("\n")) {
    const m = /^\*\s+@(\S+)/.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}

// 監視 ID の経路。severities の ack 目標（時間）を経路に足して返す
export function routeFor(routes, monitorId) {
  const route = (routes.routes || []).find((r) => r.monitor_ids.includes(monitorId));
  if (!route) return null;
  const sev = (routes.severities || {})[route.severity] || {};
  return { ...route, ack_target_hours: sev.ack_target_hours ?? 24 };
}

export function issueTitle(result, drill) {
  const prefix = drill ? "[drill]" : "";
  return `${prefix}[${result.severity}][${result.monitor_id}] ${result.name} が失敗`;
}

// タイトルから監視 ID と drill かどうかを読む
export function parseTitle(title) {
  const m = /\[(MON-\d+)\]/.exec(title);
  return { monitorId: m ? m[1] : null, drill: title.startsWith("[drill]") };
}

export function indexOpenIssues(issues, drill) {
  const byMonitor = new Map();
  for (const issue of issues) {
    const t = parseTitle(issue.title);
    if (t.monitorId && t.drill === drill && !byMonitor.has(t.monitorId)) byMonitor.set(t.monitorId, issue);
  }
  return byMonitor;
}

function actionFor(r, open) {
  if (r.result === "fail") {
    if (r.alert_suppressed) return { kind: "suppressed", result: r };
    return open ? { kind: "comment", result: r, issue: open } : { kind: "create", result: r };
  }
  return open ? { kind: "recover", result: r, issue: open } : null;
}

// 結果（results.json の results）と open な Issue から、実行する操作を決める
export function decideActions(results, openByMonitor) {
  return results.map((r) => actionFor(r, openByMonitor.get(r.monitor_id) || null)).filter((a) => a !== null);
}

function deploymentRef(marker) {
  if (!marker) return "不明（デプロイマーカーなし）";
  const tag = marker.release_tag
    ? `、リリース ${marker.release_tag}（${marker.release_published_at || "公開時刻不明"}）`
    : "";
  return `version ${marker.version}、commit ${marker.commit_sha}${tag}（観測 ${marker.at}）`;
}

function overview(result, run, marker) {
  return [
    "## 概要",
    `- 開始時刻（UTC）: ${result.at}`,
    "- 検知方法: monitoring（外形監視）",
    `- 重大度: ${result.severity}`,
    `- 影響: ${result.user_impact || "monitors.yaml の user_impact を参照"}`,
    `- 監視: ${result.monitor_id} ${result.name}（${result.type}、ジャーニー ${result.journey_id || "なし"}）`,
    `- 失敗の詳細: ${result.failure_detail}`,
    `- 試行回数: ${result.attempts}（定義の retry どおり）`,
    `- 対象: ${run.mode}、版 ${result.version || run.version || "不明"}、環境 ${run.region}`,
    `- 直前のデプロイ（deployment_ref）: ${deploymentRef(marker)}`,
    `- 実行: ${run.run_url || run.run_id}`,
  ];
}

function response(result, route, owner) {
  const ack = route ? route.ack_target_hours : 24;
  return [
    "## 対応",
    `- 担当（on-call ロール ${route ? route.oncall_ref : "role:maintainer"}）: @${owner}`,
    `- ack 目標: 検知から ${ack} 時間以内（Issue へのコメント、または assignee の確認）`,
    `- 一次対応: runbook ${result.runbook || "monitoring/runbooks/"} の「一次対応」`,
    "- 切り分け:",
    "- ロールバック有無:",
  ];
}

const PREVENTION = [
  "## 再発防止（還流先）",
  "- [ ] defect 起票",
  "- [ ] テスト追加（TC-xxx）",
  "- [ ] 監視の追加・調整（monitoring/monitors.yaml）",
  "- [ ] runbook 更新",
];

export function issueBody({ result, run, route, owner, marker, drill }) {
  const head = drill
    ? ["> **通知試験（drill）**: 意図的な障害注入による通知経路の確認。自動で close します。"]
    : [];
  const lines = [
    ...head,
    ...overview(result, run, marker),
    "",
    ...response(result, route, owner),
    "",
    ...PREVENTION,
  ];
  return `${lines.join("\n")}\n`;
}

export function ongoingComment(result, run) {
  const where = run.run_url || run.run_id;
  return `継続して失敗しています（${result.at} UTC、試行 ${result.attempts} 回）。\n- 失敗の詳細: ${result.failure_detail}\n- 版: ${result.version || "不明"}\n- 実行: ${where}\n`;
}

export function recoveryComment(result, run, downMinutes) {
  const d = downMinutes === null ? "" : `（Issue 作成から約 ${Math.round(downMinutes)} 分）`;
  const where = run.run_url || run.run_id;
  return `回復しました${d}。${result.at} UTC の実行で ${result.monitor_id} が成功（版 ${result.version || "不明"}、実行 ${where}）。\n回復を確認したため自動で close します。再発防止の還流（defect・テスト・監視・runbook）はこの Issue のチェックリストで追跡し、必要なら close 後も追記してください。\n`;
}

// ack の判定: ラベル ack、または自動投稿者以外のコメントがあれば ack 済み
export function isAcked(issue, botLogins) {
  const labels = (issue.labels || []).map((l) => l.name);
  if (labels.includes("ack")) return true;
  return (issue.comments || []).some((c) => c.author && !botLogins.includes(c.author.login));
}

// 経路のエスカレーション規則のうち、経過時間に達していて未実施のもの
export function dueEscalations(route, issue, nowMs, botLogins) {
  if (!route || isAcked(issue, botLogins)) return [];
  const hours = (nowMs - Date.parse(issue.createdAt)) / 3600000;
  const labels = (issue.labels || []).map((l) => l.name);
  return (route.escalation || []).filter(
    (e) =>
      hours >= e.after_hours &&
      !labels.includes(e.after_hours >= route.ack_target_hours ? "ack-overdue" : "escalated"),
  );
}
