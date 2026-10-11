// 通知試験（drill）の記録（monitoring/alert-tests.md 用）。純関数。
const sec = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 1000);

function buildChecks(issues, closed) {
  const some = issues.length > 0;
  const closedAll = issues.every((i) =>
    closed.some((c) => c.number === i.issue.number && c.state === "CLOSED"),
  );
  return {
    issue_created: some,
    labels_ok: some && issues.every((i) => i.labels_ok),
    assignee_verified: some && issues.every((i) => i.assignee_verified),
    recovery_detected: some && closed.length === issues.length,
    issue_closed: some && closedAll,
  };
}

function issueRows(issues, closed) {
  return issues.map((i) => {
    const c = closed.find((x) => x.number === i.issue.number);
    return {
      monitor_id: i.monitor_id,
      number: i.issue.number,
      url: i.issue.url,
      state: c ? c.state : "OPEN",
    };
  });
}

function ackOf(issues) {
  if (issues.length === 0) return { ack_method: null, ack_at: null, ack_seconds: null };
  return {
    ack_method: issues[0].ack_method,
    ack_at: issues[0].ack_at,
    ack_seconds: Math.max(...issues.map((i) => i.ack_seconds)),
  };
}

export function buildDrillRecord(state, recovery) {
  const issues = state.issues;
  const notified = issues.length ? issues.map((i) => i.notified_at).sort()[0] : null;
  const checks = buildChecks(issues, recovery.closed);
  return {
    test_id: state.test_id,
    kind: "drill",
    injected_fault: "backend コンテナの停止（docker compose stop backend）。復旧は start backend",
    repo: recovery.repo,
    detected_at: state.detected_at,
    notified_at: notified,
    notify_latency_sec: notified ? sec(state.detected_at, notified) : null,
    ...ackOf(issues),
    recovered_at: recovery.recovered_at,
    time_to_recover_sec: sec(state.detected_at, recovery.recovered_at),
    monitors: issues.map((i) => i.monitor_id),
    issues: issueRows(issues, recovery.closed),
    checks,
    result: Object.values(checks).every(Boolean) ? "pass" : "fail",
  };
}

export function renderDrillMarkdown(r) {
  const lines = [
    `### ${r.test_id}（${r.result}）`,
    "",
    `- 注入した障害: ${r.injected_fault}`,
    `- 検知（監視が失敗を確認）: ${r.detected_at} UTC`,
    `- 通知（Issue 作成）: ${r.notified_at} UTC（検知から ${r.notify_latency_sec} 秒）`,
    `- ack: ${r.ack_at} UTC（${r.ack_seconds} 秒。方法: ${r.ack_method}）`,
    `- 回復の確認: ${r.recovered_at} UTC（検知から ${r.time_to_recover_sec} 秒）`,
    `- 対象の監視: ${r.monitors.join(", ")}`,
    `- Issue: ${r.issues.map((i) => `#${i.number}（${i.state}）`).join(", ")}`,
    `- 確認項目: ${Object.entries(r.checks)
      .map(([k, v]) => `${k}=${v ? "OK" : "NG"}`)
      .join(", ")}`,
    "",
  ];
  return lines.join("\n");
}
