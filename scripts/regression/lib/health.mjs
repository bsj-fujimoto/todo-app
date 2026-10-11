// ワークフロー実行履歴 → 健全性の指標（成功率・所要時間・連続失敗）。入力は GitHub API の workflow runs。
const DONE = new Set(["success", "failure", "cancelled", "timed_out", "startup_failure"]);
const seconds = (r) =>
  Math.max(0, Math.round((Date.parse(r.updated_at) - Date.parse(r.run_started_at ?? r.created_at)) / 1000));

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function consecutiveFailures(runsNewestFirst) {
  const idx = runsNewestFirst.findIndex((r) => r.conclusion === "success");
  return idx === -1 ? runsNewestFirst.length : idx;
}

/** runsNewestFirst: 新しい順。cancelled は成功率の母数から外す（人が止めたもの）が、件数は残す。 */
export function summarizeRuns(name, runsNewestFirst) {
  const done = runsNewestFirst.filter((r) => DONE.has(r.conclusion));
  const counted = done.filter((r) => r.conclusion !== "cancelled");
  const ok = counted.filter((r) => r.conclusion === "success");
  const durations = ok.map(seconds).sort((a, b) => a - b);
  return {
    workflow: name,
    runs_observed: done.length,
    cancelled: done.length - counted.length,
    success_rate: counted.length ? Math.round((ok.length / counted.length) * 1000) / 1000 : null,
    duration_sec: {
      median: percentile(durations, 50),
      p95: percentile(durations, 95),
      max: percentile(durations, 100),
    },
    consecutive_failures: consecutiveFailures(counted),
    last_success_at: ok[0]?.updated_at ?? null,
  };
}

/** 閾値と対処（健全性の運用ルール。quality/README.md 参照）。 */
export function evaluateHealth(summary, limits) {
  const problems = [];
  if (summary.success_rate !== null && summary.success_rate < limits.min_success_rate) {
    problems.push(`成功率 ${summary.success_rate} が下限 ${limits.min_success_rate} 未満`);
  }
  if (summary.consecutive_failures >= limits.max_consecutive_failures) {
    problems.push(`${summary.consecutive_failures} 回連続で失敗`);
  }
  const p95 = summary.duration_sec.p95;
  if (p95 !== null && p95 > limits.max_p95_sec)
    problems.push(`所要時間 p95 ${p95}s が上限 ${limits.max_p95_sec}s 超`);
  return problems;
}
