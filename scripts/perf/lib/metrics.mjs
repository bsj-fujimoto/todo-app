// シナリオごとの verdict から、ベースライン比較・記録に使う指標（キー = <シナリオ>.<指標名>）を平らに取り出す。純関数。
import { round } from "./stats.mjs";

function fromJudgements(prefix, list) {
  const out = {};
  for (const j of list || []) if (j.mean !== null) out[`${prefix}.${j.metric}`] = j.mean;
  return out;
}

function capacityMetrics(v) {
  const out = { "capacity.max_tasks_within_slo": v.max_tasks_within_slo };
  for (const s of v.steps) {
    out[`capacity.list_p95_ms_at_${s.tasks}`] = s.list_p95_ms;
    out[`capacity.create_p95_ms_at_${s.tasks}`] = s.create_p95_ms;
  }
  return out;
}

function spikeMetrics(v) {
  return {
    "spike.recovery_tail_list_p95_ms": v.recovery.list_p95_ms.mean,
    "spike.recovery_tail_error_rate": v.recovery.error_rate.mean,
    "spike.time_to_recover_sec": v.recovery.time_to_recover_sec,
    "spike.during_list_p95_ms": v.during_spike.list_p95_ms_mean,
  };
}

const EXTRACTORS = {
  load: (v) => fromJudgements("load", v.slo_judgements),
  stress: (v) => ({ "stress.max_sustained_rps": v.max_sustained_rps }),
  spike: spikeMetrics,
  soak: (v) => fromJudgements("soak", v.slo_judgements),
  capacity: capacityMetrics,
  screen: (v) => fromJudgements("screen", v.slo_judgements),
};

export function flattenMetrics(verdicts) {
  const out = {};
  for (const v of verdicts) Object.assign(out, EXTRACTORS[v.scenario](v));
  const entries = Object.entries(out).filter(([, val]) => val !== null && val !== undefined);
  return Object.fromEntries(entries.map(([k, val]) => [k, round(val, 6)]));
}

// 値が小さいほど良い指標か（latency・error・メモリ）。大きいほど良いのは throughput・限界点・容量
export function lowerIsBetter(key) {
  return !/(throughput|max_sustained|max_tasks_within_slo)/.test(key);
}
