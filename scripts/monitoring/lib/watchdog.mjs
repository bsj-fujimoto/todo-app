// 監視の死活監視（監視基盤自身の沈黙の検知）。純関数。synthetic.yml の最終実行が thresholdHours 時間より前なら stale。
// しきい値は実測の実効間隔から決める（monitors.yaml の watchdog.threshold_hours。根拠は monitoring/README.md）。

// 実際に動いた run だけを数える。skipped（workflow_run の条件外）・cancelled（concurrency で置き換わった待ち run）・
// startup_failure は「監視が動いた」証拠にならない。実行中・待機中（conclusion が null）は、起動はしているので数える。
const NOT_RAN = new Set(["skipped", "cancelled", "startup_failure"]);

export function lastRanRun(runs) {
  const ran = runs.filter((r) => !NOT_RAN.has(r.conclusion));
  return ran.reduce(
    (best, r) => (!best || Date.parse(r.createdAt) > Date.parse(best.createdAt) ? r : best),
    null,
  );
}

export function staleTitle(thresholdHours) {
  return `外形監視が ${thresholdHours} 時間以上実行されていない`;
}

export function staleness({ lastCreatedAt, nowMs, thresholdHours }) {
  if (!lastCreatedAt) {
    return { stale: true, hoursSince: null, detail: "synthetic.yml の実行履歴が無い" };
  }
  const hoursSince = (nowMs - Date.parse(lastCreatedAt)) / 3600000;
  const rounded = Math.round(hoursSince * 10) / 10;
  if (hoursSince > thresholdHours) {
    return {
      stale: true,
      hoursSince: rounded,
      detail: `synthetic.yml の最終実行が ${rounded} 時間前（${lastCreatedAt}）。しきい値 ${thresholdHours} 時間（実測の実効間隔から決めた値。schedule の遅延・欠落、または無効化の可能性）`,
    };
  }
  return { stale: false, hoursSince: rounded, detail: `最終実行 ${rounded} 時間前（${lastCreatedAt}）` };
}
