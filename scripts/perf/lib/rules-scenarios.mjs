// stress / spike / soak / capacity の判定（規則の全体は rules.mjs の冒頭コメント）。純関数。
// どの判定も `series`（名前 → 反復ごとの値の配列）を返し、呼び出し側が平均・標準偏差・95% 信頼区間（variance_stats）にする。
import {
  DRIFT_PCT,
  ENDPOINT_SLO,
  MEM_FAIL_RATIO,
  MEM_WARN_RATIO,
  errorRateOf,
  judgeMetric,
  meanOf,
  violationsOf,
} from "./rules.mjs";
import { round } from "./stats.mjs";
import { timeToRecover } from "./timeline.mjs";

const result = (scenario, reasons, warnings, extra) => ({
  scenario,
  status: reasons.length ? "fail" : "pass",
  reasons,
  warnings,
  ...extra,
});

const listP95 = (seg) => (seg ? seg.endpoints.list.p95 : null);

// ---- stress: 限界点（最初に SLO・エラー・取りこぼしのいずれかを割る段）
function stageRows(slo, iteration, stages, stageSec) {
  const groups = iteration.segments.main.groups.stage || {};
  return stages.map((rate) => ({
    rate,
    reasons: groups[rate] ? violationsOf(slo, groups[rate], rate, stageSec) : ["段のデータなし"],
  }));
}

export function verdictStress(slo, iterations, stages, stageSec) {
  const perIter = iterations.map((it) => stageRows(slo, it, stages, stageSec));
  const first = perIter.map((rows) => rows.find((r) => r.reasons.length > 0) || null);
  const rates = first.filter((v) => v !== null).map((v) => v.rate);
  const worstFirst = rates.length ? Math.min(...rates) : null;
  const sustained = stages.filter((r) => worstFirst === null || r < worstFirst);
  const baseErrors = perIter.flatMap((rows) => rows[0].reasons.filter((x) => x.startsWith("エラー率")));
  const series = { first_violation_rps: first.map((v) => (v ? v.rate : null)) };
  for (const rate of stages) {
    series[`list_p95_ms@${rate}rps`] = iterations.map((it) =>
      listP95((it.segments.main.groups.stage || {})[rate]),
    );
  }
  return result(
    "stress",
    baseErrors.map((r) => `想定負荷の段で ${r}`),
    [],
    {
      max_sustained_rps: sustained.length ? Math.max(...sustained) : null,
      first_violation_rps: worstFirst,
      first_violation_per_iteration: first.map((v, i) => ({
        iteration: i + 1,
        rps: v ? v.rate : null,
        reasons: v ? v.reasons : [],
      })),
      stages_rps: stages,
      series,
      note: "stress は SLO の合否を判定しない。限界点（SLO・エラー・取りこぼしのいずれかを最初に割る到着率）を求める。",
    },
  );
}

// ---- spike: 跳ね上がり後に、RECOVERY_BUDGET_SEC 秒以内に list p95 が SLO 内・エラー < 1% に戻り、末尾 30 秒でも保たれること
export const RECOVERY_BUDGET_SEC = 30;
const phaseOf = (it, name) => (it.segments.main.groups.phase || {})[name];
const timelineOf = (it) => it.segments.main.phase_timeline || null;
const tailOf = (it) => {
  const t = timelineOf(it);
  return t && t.tail ? t.tail : null;
};

function spikeReasons(ttr, list, err) {
  const reasons = [list, err]
    .filter((j) => j.pass !== true)
    .map(
      (j) => `回復期の末尾 30 秒 ${j.metric}: 平均 ${j.mean} が目標 ${j.operator} ${j.target} を満たさない`,
    );
  if (ttr.some((v) => v === null))
    reasons.push("跳ね上がりの後、回復期の終わりまでに SLO 内へ戻らなかった反復がある");
  const mean = meanOf(ttr);
  if (mean !== null && mean > RECOVERY_BUDGET_SEC) {
    reasons.push(`回復に平均 ${round(mean, 1)} 秒（> ${RECOVERY_BUDGET_SEC} 秒）`);
  }
  return reasons;
}

function spikeSeries(iterations, ttr, tails) {
  const during = iterations.map((it) => phaseOf(it, "spike"));
  return {
    time_to_recover_sec: ttr,
    "recovery_tail.list_p95_ms": tails.map((t) => (t ? t.list_p95 : null)),
    "recovery_phase.list_p95_ms": iterations.map((it) => listP95(phaseOf(it, "recovery"))),
    "spike.list_p95_ms": during.map(listP95),
    "base.list_p95_ms": iterations.map((it) => listP95(phaseOf(it, "base"))),
    "spike.error_rate": during.map((p) => (p ? errorRateOf(p) : null)),
  };
}

export function verdictSpike(slo, iterations) {
  const target = slo.api_list_p95_ms.target;
  const ttr = iterations.map((it) => {
    const t = timelineOf(it);
    return t ? timeToRecover(t.buckets, target, slo.error_rate.target) : null;
  });
  const tails = iterations.map(tailOf);
  const list = judgeMetric(
    slo.api_list_p95_ms,
    tails.map((t) => (t ? t.list_p95 : null)),
  );
  const err = judgeMetric(
    slo.error_rate,
    tails.map((t) => (t ? t.error_rate : null)),
  );
  const series = spikeSeries(iterations, ttr, tails);
  const stats = (it) => it.segments.main;
  return result("spike", spikeReasons(ttr, list, err), [...list.warnings, ...err.warnings], {
    recovery: {
      list_p95_ms: list,
      error_rate: err,
      time_to_recover_sec: meanOf(ttr),
      budget_sec: RECOVERY_BUDGET_SEC,
    },
    during_spike: {
      list_p95_ms_mean: round(meanOf(series["spike.list_p95_ms"])),
      error_rate_mean: round(meanOf(series["spike.error_rate"]), 6),
      achieved_rps_mean: round(meanOf(iterations.map((it) => stats(it).achieved_rps)), 2),
      dropped_iterations_mean: meanOf(iterations.map((it) => stats(it).dropped_iterations)),
    },
    before_spike_list_p95_ms_mean: round(meanOf(series["base.list_p95_ms"])),
    series,
  });
}

// ---- soak: 時間劣化（前半 vs 後半）
function fullBuckets(groups) {
  const rows = Object.entries(groups).map(([k, v]) => ({
    k: Number(k),
    n: v.requests,
    p95: v.endpoints.list.p95,
  }));
  const sorted = rows.sort((a, b) => a.k - b.k).filter((r) => r.p95 !== undefined);
  const counts = sorted.map((r) => r.n).sort((a, b) => a - b);
  const typical = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  return sorted.filter((r) => r.n >= typical * 0.8);
}

// 最初の 2 分と最後の 2 分（要求数が通常の 8 割以上の完全な分だけ）の list p95 の平均の変化率（%）
export function driftPct(groups) {
  const b = fullBuckets(groups);
  if (b.length < 4) return null;
  const head = meanOf(b.slice(0, 2).map((r) => r.p95));
  const tail = meanOf(b.slice(-2).map((r) => r.p95));
  return head > 0 ? round(((tail - head) / head) * 100, 2) : null;
}

function memoryGrowth(it) {
  const be = it.observe && it.observe.services.backend;
  return be && be.memory ? be.memory.growth_ratio : null;
}

function soakChecks(driftMean, memMean) {
  const reasons = [];
  const warnings = [];
  if (driftMean !== null && driftMean > DRIFT_PCT) {
    reasons.push(`list p95 が前半→後半で ${round(driftMean, 1)}% 悪化（> ${DRIFT_PCT}%）`);
  }
  if (memMean !== null && memMean > MEM_FAIL_RATIO) {
    reasons.push(`backend メモリが ${round(memMean, 2)} 倍に増加（> ${MEM_FAIL_RATIO} 倍）`);
  } else if (memMean !== null && memMean > MEM_WARN_RATIO) {
    warnings.push(`backend メモリが ${round(memMean, 2)} 倍に増加（> ${MEM_WARN_RATIO} 倍）`);
  }
  return { reasons, warnings };
}

export function verdictSoak(slo, iterations) {
  const segs = iterations.map((it) => it.segments.main);
  const drifts = segs.map((s) => driftPct(s.groups.bucket || {}));
  const mem = iterations.map(memoryGrowth);
  const list = judgeMetric(slo.api_list_p95_ms, segs.map(listP95));
  const err = judgeMetric(slo.error_rate, segs.map(errorRateOf));
  const extra = soakChecks(meanOf(drifts), meanOf(mem));
  const reasons = [list, err]
    .filter((j) => j.pass !== true)
    .map((j) => `${j.metric}: 平均 ${j.mean} が目標を満たさない`)
    .concat(extra.reasons);
  return result("soak", reasons, [...list.warnings, ...err.warnings, ...extra.warnings], {
    slo_judgements: [list, err],
    series: {
      list_p95_ms: segs.map(listP95),
      error_rate: segs.map(errorRateOf),
      list_p95_drift_pct: drifts,
      backend_memory_growth_ratio: mem,
    },
  });
}

// ---- capacity: 件数ごとの SLO
function stepSummary(slo, iterations, n) {
  const segs = iterations.map((it) => it.segments[`step-${n}`]).filter(Boolean);
  const avg = (f) => meanOf(segs.map(f));
  const endpoints = {};
  for (const ep of Object.keys(ENDPOINT_SLO)) endpoints[ep] = { p95: avg((s) => s.endpoints[ep].p95) };
  const merged = {
    endpoints,
    requests: avg((s) => s.requests),
    error_rate: avg((s) => s.error_rate),
    check_fail_rate: avg((s) => s.check_fail_rate),
  };
  return {
    tasks: n,
    iterations: segs.length,
    list_p95_ms: round(endpoints.list.p95, 3),
    create_p95_ms: round(endpoints.create.p95, 3),
    toggle_p95_ms: round(endpoints.toggle.p95, 3),
    delete_p95_ms: round(endpoints.delete.p95, 3),
    error_rate: round(errorRateOf(merged), 6),
    violations: violationsOf(slo, merged),
    list_p95_per_iteration: segs.map(listP95),
  };
}

// capacity: SLO の適用範囲（scopeTasks = 通常の件数 1,000）では SLO を満たすことを必須（fail）にする。
// それを超える件数（成長予測 10,000 件まで）は容量計画の指標で、SLO を超えても fail にはせず警告にする（max_tasks_within_slo に記録）。
// 環境（runner など CPU が遅い）で「SLO 内で捌ける最大件数」は変わるため、件数の上限は環境ごとの観測値として扱う。
export function verdictCapacity(slo, iterations, steps, scopeTasks) {
  const perStep = steps.map((n) => stepSummary(slo, iterations, n));
  const firstBad = perStep.find((s) => s.violations.length > 0);
  const okBefore = perStep.filter((s) => !firstBad || s.tasks < firstBad.tasks).map((s) => s.tasks);
  const message = (s) => `${s.tasks} 件で SLO の目標を超える: ${s.violations.join(", ")}`;
  const inScope = perStep.filter((s) => s.tasks <= scopeTasks && s.violations.length > 0);
  const beyond = perStep.filter((s) => s.tasks > scopeTasks && s.violations.length > 0);
  const series = {};
  for (const s of perStep) series[`list_p95_ms@${s.tasks}tasks`] = s.list_p95_per_iteration;
  return result(
    "capacity",
    inScope.map(message),
    beyond.map((s) => `${message(s)}（SLO の適用範囲 ${scopeTasks} 件を超える。容量計画の指標）`),
    {
      steps: perStep,
      scope_tasks: scopeTasks,
      max_tasks_within_slo: okBefore.length ? Math.max(...okBefore) : 0,
      series,
    },
  );
}
