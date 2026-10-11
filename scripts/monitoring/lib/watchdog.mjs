// 監視の死活監視（監視基盤自身の沈黙の検知）。純関数。synthetic.yml の最終実行が thresholdHours 時間より前なら stale。
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
      detail: `synthetic.yml の最終実行が ${rounded} 時間前（${lastCreatedAt}）。しきい値 ${thresholdHours} 時間（30 分ごとの schedule が止まっている可能性）`,
    };
  }
  return { stale: false, hoursSince: rounded, detail: `最終実行 ${rounded} 時間前（${lastCreatedAt}）` };
}
