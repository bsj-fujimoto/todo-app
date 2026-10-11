// 統計の純関数。時刻・乱数は使わない（lint 規約）。
// パーセンタイルは k6 と同じ線形補間（R-7: 位置 = p × (n - 1)）で求める。

export function sortedCopy(values) {
  return [...values].sort((a, b) => a - b);
}

export function percentileSorted(sorted, p) {
  const n = sorted.length;
  if (n === 0) return null;
  if (n === 1) return sorted[0];
  const pos = p * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function percentile(values, p) {
  return percentileSorted(sortedCopy(values), p);
}

export function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// 標本標準偏差（n - 1）。n < 2 のとき null
export function stddev(values) {
  const n = values.length;
  if (n < 2) return null;
  const m = mean(values);
  const ss = values.reduce((a, v) => a + (v - m) ** 2, 0);
  return Math.sqrt(ss / (n - 1));
}

// t 分布の両側 95%（上側 2.5%）の臨界値。自由度 1〜30。それ以上は 1.96 に近づく
const T975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131,
  2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export function tCritical95(df) {
  if (df < 1) return null;
  return df <= T975.length ? T975[df - 1] : 1.96;
}

// 反復間のばらつき。n 回の測定値から 平均・標準偏差・95% 信頼区間（t 分布）を返す
export function varianceStats(values) {
  const n = values.length;
  const m = mean(values);
  const sd = stddev(values);
  if (n < 2 || sd === null) return { n, mean: m, sd, ci95: null, cv: null };
  const half = tCritical95(n - 1) * (sd / Math.sqrt(n));
  return { n, mean: m, sd, ci95: [m - half, m + half], cv: m === 0 ? null : sd / Math.abs(m) };
}

// 上位 fraction（既定 0.1% = 0.001）を外れ値として除く。少なくとも 1 件は除く（n ≥ 100 のとき）。
// n が 1000 未満でも ceil で 1 件除く。n < 100 のときは除かない（標本が少なく外れ値の判定ができない）
export function trimTop(values, fraction = 0.001, minN = 100) {
  const sorted = sortedCopy(values);
  if (sorted.length < minN) return { kept: sorted, dropped: [] };
  const drop = Math.ceil(sorted.length * fraction);
  return { kept: sorted.slice(0, sorted.length - drop), dropped: sorted.slice(sorted.length - drop) };
}

export function round(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// 区間 [a, b] の単純な線形回帰の傾き（y = a + b x の b）。x は等間隔でなくてよい
export function slope(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = mean(points.map((p) => p[0]));
  const my = mean(points.map((p) => p[1]));
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}
