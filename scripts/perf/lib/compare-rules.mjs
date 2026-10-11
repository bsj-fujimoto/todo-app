// ベースラインとの比較（退行検出）。純関数。
// 規則: 同じ指標名で比較する。悪化率 = (現在 - 基準) / 基準（大きいほど良い指標は符号を反転）。
//       悪化率が閾値（既定 +20%）を超え、かつ絶対差が下限（ノイズ除け: ms は 5、率は 0.001、他は 0）以上なら退行。
import { lowerIsBetter } from "./metrics.mjs";
import { round } from "./stats.mjs";

export function floorFor(key, floors) {
  if (/_ms($|_)/.test(key)) return floors.ms ?? 0;
  if (/_sec($|_)/.test(key)) return floors.sec ?? 0;
  if (/(error_rate)/.test(key)) return floors.ratio ?? 0;
  return floors.other ?? 0;
}

function changeRatio(base, worse) {
  if (base !== 0) return worse / Math.abs(base);
  return worse > 0 ? Infinity : 0;
}

function thresholdFor(key, cfg) {
  const own = cfg.metrics ? cfg.metrics[key] : undefined;
  return own === undefined ? cfg.regression_threshold_pct : own;
}

export function compareMetric(key, base, cur, cfg) {
  const pct = thresholdFor(key, cfg);
  const worse = lowerIsBetter(key) ? cur - base : base - cur;
  const ratio = changeRatio(base, worse);
  const big = Math.abs(cur - base) >= floorFor(key, cfg.min_abs_delta || {});
  return {
    key,
    baseline: base,
    current: cur,
    change_pct: Number.isFinite(ratio) ? round(ratio * 100, 2) : null,
    threshold_pct: pct,
    regressed: ratio * 100 > pct && big,
  };
}

export function compareAll(baselineMetrics, currentMetrics, cfg) {
  const keys = Object.keys(baselineMetrics).filter((k) => k in currentMetrics);
  const rows = keys.map((k) => compareMetric(k, baselineMetrics[k], currentMetrics[k], cfg));
  return {
    compared: rows.length,
    only_in_baseline: Object.keys(baselineMetrics).filter((k) => !(k in currentMetrics)),
    only_in_current: Object.keys(currentMetrics).filter((k) => !(k in baselineMetrics)),
    regressions: rows.filter((r) => r.regressed),
    rows,
  };
}
