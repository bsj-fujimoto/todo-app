// k6 の生データ（collected）から、判定に使う統計量を出す。純関数。
// 統計量: p95 を主（平均のみでは判定しない）。外れ値: warm-up 除外（そもそも別実行）＋ 上位 0.1% 除外（n ≥ 100 のとき）。
import { percentileSorted, round, sortedCopy, trimTop } from "./stats.mjs";

export const ENDPOINTS = ["list", "create", "toggle", "delete"];

// 1 つの応答時間列 → 判定用の統計。p95 / p99 は上位 0.1% を除いた値（judged）。除かない値は raw_* に残す
export function latencyStats(values) {
  const n = values.length;
  if (n === 0) return { n: 0 };
  const all = sortedCopy(values);
  const { kept, dropped } = trimTop(values);
  return {
    n,
    dropped_outliers: dropped.length,
    p50: round(percentileSorted(kept, 0.5)),
    p90: round(percentileSorted(kept, 0.9)),
    p95: round(percentileSorted(kept, 0.95)),
    p99: round(percentileSorted(kept, 0.99)),
    max: round(all[all.length - 1]),
    raw_p95: round(percentileSorted(all, 0.95)),
    raw_p99: round(percentileSorted(all, 0.99)),
    raw_p999: round(percentileSorted(all, 0.999)),
  };
}

function byEndpoint(durations) {
  const out = {};
  for (const ep of ENDPOINTS) {
    out[ep] = latencyStats(durations.filter((d) => d.endpoint === ep).map((d) => d.v));
  }
  return out;
}

function failRate(rows) {
  if (rows.length === 0) return null;
  return rows.filter((r) => r.v === 1).length / rows.length;
}

function checkFailRate(rows) {
  if (rows.length === 0) return null;
  return rows.filter((r) => r.v === 0).length / rows.length;
}

// 切り出し: タグ tag の値が value の点だけ
function slice(c, tag, value) {
  const keep = (r) => r[tag] === value;
  return {
    durations: c.durations.filter(keep),
    failed: c.failed.filter(keep),
    checks: c.checks.filter(keep),
  };
}

function summarize(part) {
  return {
    requests: part.durations.length,
    endpoints: byEndpoint(part.durations),
    error_rate: round(failRate(part.failed), 6),
    check_fail_rate: round(checkFailRate(part.checks), 6),
  };
}

export function tagValues(c, tag) {
  const set = new Set(c.durations.map((d) => d[tag]).filter((v) => v !== undefined));
  return [...set].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)));
}

function isoOrNull(ms) {
  return ms === null ? null : new Date(ms).toISOString();
}

function windowOf(c) {
  const secs = c.firstMs === null ? 0 : (c.lastMs - c.firstMs) / 1000;
  return {
    start_ms: c.firstMs,
    end_ms: c.lastMs,
    start: isoOrNull(c.firstMs),
    end: isoOrNull(c.lastMs),
    seconds: round(secs, 2),
  };
}

function groupsOf(c, tags) {
  const groups = {};
  for (const tag of tags) {
    groups[tag] = {};
    for (const v of tagValues(c, tag)) groups[tag][v] = summarize(slice(c, tag, v));
  }
  return groups;
}

export function analyzeSegment(c, opts = {}) {
  const window = windowOf(c);
  const out = {
    window,
    ...summarize(c),
    iterations: c.iterations,
    dropped_iterations: c.dropped,
    achieved_rps: window.seconds > 0 ? round(c.iterations / window.seconds, 3) : null,
    groups: groupsOf(c, opts.groupBy || []),
  };
  if (opts.rate && opts.durationSec) {
    out.throughput_ratio = round(c.iterations / (opts.rate * opts.durationSec), 4);
  }
  return out;
}
