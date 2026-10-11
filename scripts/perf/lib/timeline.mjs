// フェーズ内の時間推移（spike の回復期など）。純関数。
// 回復期の p95 をフェーズ全体で 1 つにすると、跳ね上がり直後の「溜まった要求が捌けるまで」の遅延に引きずられ、
// 「いつ戻ったか」が分からない。そこで 5 秒ごとの list p95 の推移と、フェーズ末尾 N 秒の p95 を出す。
import { percentile, round } from "./stats.mjs";

const inPhase = (rows, phase) => rows.filter((r) => r.phase === phase);

function p95OfList(rows) {
  const v = rows.filter((r) => r.endpoint === "list").map((r) => r.v);
  return v.length ? round(percentile(v, 0.95)) : null;
}

function errorRateOf(rows) {
  return rows.length ? round(rows.filter((r) => r.v === 1).length / rows.length, 6) : null;
}

// フェーズの開始からの経過で bucketSec ごとに区切る
export function phaseTimeline(c, phase, bucketSec) {
  const dur = inPhase(c.durations, phase);
  if (dur.length === 0) return null;
  const failed = inPhase(c.failed, phase);
  const start = Math.min(...dur.map((r) => r.ms));
  const end = Math.max(...dur.map((r) => r.ms));
  const size = bucketSec * 1000;
  const buckets = [];
  for (let t = start; t <= end; t += size) {
    const d = dur.filter((r) => r.ms >= t && r.ms < t + size);
    const f = failed.filter((r) => r.ms >= t && r.ms < t + size);
    buckets.push({
      t_sec: Math.round((t - start) / 1000),
      requests: d.length,
      list_p95: p95OfList(d),
      error_rate: errorRateOf(f),
    });
  }
  return { start_ms: start, end_ms: end, buckets };
}

// フェーズ末尾 tailSec 秒の list p95 とエラー率（定常に戻ったかの判定に使う）
export function phaseTail(c, phase, tailSec) {
  const dur = inPhase(c.durations, phase);
  if (dur.length === 0) return null;
  const end = Math.max(...dur.map((r) => r.ms));
  const from = end - tailSec * 1000;
  const d = dur.filter((r) => r.ms >= from);
  const f = inPhase(c.failed, phase).filter((r) => r.ms >= from);
  return { seconds: tailSec, requests: d.length, list_p95: p95OfList(d), error_rate: errorRateOf(f) };
}

function bucketState(b, target, errorLimit) {
  if (b.list_p95 === null) return "empty";
  return b.list_p95 <= target && (b.error_rate ?? 0) < errorLimit ? "ok" : "bad";
}

// 回復までの時間: この区間以降の全区間で list p95 が target 以下・エラー率 < errorLimit になる最初の区間の開始（秒）。戻らなければ null
export function timeToRecover(buckets, target, errorLimit) {
  let from = null;
  for (let i = buckets.length - 1; i >= 0; i -= 1) {
    const state = bucketState(buckets[i], target, errorLimit);
    if (state === "bad") break;
    if (state === "ok") from = buckets[i].t_sec;
  }
  return from;
}
