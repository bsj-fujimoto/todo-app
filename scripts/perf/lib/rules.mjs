// 判定規則（文書化したコード）。純関数のみ。入力: SLO（perf/slo.yaml）と、反復ごとの分析結果。出力: pass / fail と理由。
//
// ■ 統計量     p95 を主に使う（レイテンシ。p99 は SLO にあるものだけ）。平均のみで合否を決めない。
//               エラー率は rate、スループットは「目標到着率に対する達成率」。
// ■ 外れ値     warm-up 30 秒は別実行で判定から除く。seed・setup の要求も除く。各エンドポイントの応答時間は
//               上位 0.1%（n ≥ 100 のとき ceil）を除いて p95 / p99 を求める（除外前は raw_* に併記）。
// ■ エラー     エラー率 = max(http_req_failed の率, checks 失敗率)。SLO の error_rate（< 1%）で判定する。
//               想定した 4xx は k6 側で「期待どおり」として数えない（本試験は 4xx を起こさない）。
// ■ SLO 違反   判定値 = 3 反復の平均。平均が target を満たさなければ fail。
//               平均が満たしていても、(a) 反復のいずれかが満たさない、(b) 95% 信頼区間の悪い側の端が満たさない、
//               の場合は warning を残す（pass のまま。ばらつきが大きく結論が弱いことを示す）。
// ■ 試験種別ごとの合否
//     load      SLO の全指標（latency / error / throughput / health）。
//     stress    SLO は判定しない。限界点（最初に SLO・エラー・取りこぼしのいずれかを割る段）を求める。合否はエラー率が最初の段（想定負荷）で < 1%。
//     spike     跳ね上がり後 30 秒以内に list p95 が SLO 内・エラー率 < 1% に戻り（5 秒区間の推移から求める）、回復期の末尾 30 秒の p95・エラー率も SLO 内。
//     soak      エラー率 < 1%、list p95 が SLO 内、後半の p95 が前半より +DRIFT_PCT% 超悪化しない。メモリ増加は warning（+20%）/ fail（+50%）。
//     capacity  各件数（1,000 → 10,000）で list / create / toggle / delete の p95 と error が SLO 内（超えた件数を max_tasks_within_slo に記録）。
import { mean, round, varianceStats } from "./stats.mjs";

export const VERDICT_RULE = {
  statistic:
    "p95（レイテンシ。p99 は SLO にあるものだけ）。エラーは rate、スループットは目標到着率に対する達成率。平均のみでは判定しない",
  outlier_policy:
    "warm-up 30 秒を別実行として除外。seed / setup の要求を除外。各エンドポイントの応答時間は上位 0.1%（n ≥ 100 のとき ceil）を除いて p95 / p99 を計算（除外前は raw_* に併記）",
  error_threshold: "エラー率 = max(http_req_failed 率, checks 失敗率) < 1%（perf/slo.yaml の error_rate）",
  slo_violation_rule:
    "判定値 = 3 反復の平均。平均が perf/slo.yaml の target を満たさなければ fail。反復のいずれか、または 95% 信頼区間の悪い側の端が満たさない場合は warning（pass のまま記録）",
  slo_ref: "perf/slo.yaml",
};

export const DRIFT_PCT = 20;
export const MEM_WARN_RATIO = 1.2;
export const MEM_FAIL_RATIO = 1.5;
export const ENDPOINT_SLO = {
  list: "api_list_p95_ms",
  create: "api_create_p95_ms",
  toggle: "api_update_p95_ms",
  delete: "api_delete_p95_ms",
};

export function sloMap(sloDoc) {
  const m = {};
  for (const s of sloDoc.slos) m[s.metric] = s;
  return m;
}

export function satisfies(value, slo) {
  if (value === null || value === undefined) return null;
  if (slo.operator === "<=") return value <= slo.target;
  if (slo.operator === "<") return value < slo.target;
  if (slo.operator === ">=") return value >= slo.target;
  return value > slo.target;
}

const orNull = (v) => (v === undefined ? null : v);

// エラー率 = http_req_failed の率と checks 失敗率の大きいほう
export function errorRateOf(seg) {
  const errors = [seg.error_rate, seg.check_fail_rate].filter((v) => v !== null && v !== undefined);
  return errors.length ? Math.max(...errors) : null;
}

// 1 つのセグメント分析から SLO 指標の値を取り出す
export function metricsOf(seg, observe) {
  const ep = seg.endpoints;
  return {
    api_list_p95_ms: orNull(ep.list.p95),
    api_list_p99_ms: orNull(ep.list.p99),
    api_create_p95_ms: orNull(ep.create.p95),
    api_update_p95_ms: orNull(ep.toggle.p95),
    api_delete_p95_ms: orNull(ep.delete.p95),
    error_rate: errorRateOf(seg),
    throughput_rps: orNull(seg.throughput_ratio),
    health_p95_ms: observe && observe.health ? observe.health.p95_ms : null,
  };
}

// 反復ごとの値 → 判定（平均・標準偏差・95%CI・warning）
function warningsFor(slo, pass, present, vs) {
  const warnings = [];
  if (!pass) return warnings;
  const iterFail = present.filter((v) => satisfies(v, slo) === false).length;
  if (iterFail > 0) warnings.push(`${iterFail} / ${present.length} 反復が目標を満たさない`);
  const goodSideFirst = slo.operator.startsWith(">");
  const edge = vs.ci95 ? vs.ci95[goodSideFirst ? 0 : 1] : null;
  if (edge !== null && satisfies(edge, slo) === false) warnings.push("95% 信頼区間の端が目標を超える");
  return warnings;
}

// 反復ごとの値 → 判定（平均・標準偏差・95%CI・warning）
export function judgeMetric(slo, values) {
  const present = values.filter((v) => v !== null && v !== undefined);
  const vs = varianceStats(present);
  const pass = satisfies(vs.mean, slo);
  return {
    metric: slo.metric,
    operator: slo.operator,
    target: slo.target,
    unit: slo.unit,
    values: present.map((v) => round(v, 6)),
    mean: round(vs.mean, 6),
    sd: round(vs.sd, 6),
    ci95: vs.ci95 ? vs.ci95.map((v) => round(v, 6)) : null,
    pass,
    warnings: warningsFor(slo, pass, present, vs),
  };
}

export function summarizeVariance(judgements) {
  const out = {};
  for (const j of judgements) out[j.metric] = { n: j.values.length, mean: j.mean, sd: j.sd, ci95: j.ci95 };
  return out;
}

export function describeVariance(judgements) {
  return judgements
    .filter((j) => j.values.length > 0)
    .map(
      (j) =>
        `${j.metric}: n=${j.values.length} mean=${j.mean} sd=${j.sd} ci95=${j.ci95 ? `[${j.ci95[0]}, ${j.ci95[1]}]` : "-"}`,
    )
    .join("; ");
}

// 反復ごとの値の並び（series: 名前 → 値の配列）から、平均・標準偏差・95% 信頼区間の文字列とオブジェクトを作る
export function seriesVariance(series) {
  const out = {};
  for (const [name, values] of Object.entries(series)) {
    const present = values.filter((v) => v !== null && v !== undefined);
    if (present.length === 0) continue;
    const vs = varianceStats(present);
    out[name] = {
      n: vs.n,
      mean: round(vs.mean, 4),
      sd: round(vs.sd, 4),
      ci95: vs.ci95 ? vs.ci95.map((v) => round(v, 4)) : null,
    };
  }
  return out;
}

export function describeSeries(series) {
  return Object.entries(seriesVariance(series))
    .map(
      ([k, v]) =>
        `${k}: n=${v.n} mean=${v.mean} sd=${v.sd} ci95=${v.ci95 ? `[${v.ci95[0]}, ${v.ci95[1]}]` : "-"}`,
    )
    .join("; ");
}

function perIter(iterations, pick) {
  return iterations.map(pick);
}

export function verdictLoad(slo, iterations) {
  const per = perIter(iterations, (it) => metricsOf(it.segments.main, it.observe));
  const judgements = [];
  const notJudged = [];
  for (const [name, s] of Object.entries(slo)) {
    const values = per.map((m) => m[name]).filter((v) => v !== undefined);
    if (values.length === 0) notJudged.push(name);
    else judgements.push(judgeMetric(s, values));
  }
  const failed = judgements.filter((j) => j.pass === false);
  return {
    scenario: "load",
    status: failed.length === 0 ? "pass" : "fail",
    reasons: failed.map(
      (j) => `${j.metric}: 平均 ${j.mean}${j.unit} が目標 ${j.operator} ${j.target} を満たさない`,
    ),
    warnings: judgements.flatMap((j) => j.warnings.map((w) => `${j.metric}: ${w}`)),
    slo_judgements: judgements,
    not_judged_here: notJudged,
    variance_stats: summarizeVariance(judgements),
  };
}

function latencyViolations(slo, seg) {
  const out = [];
  for (const [ep, metric] of Object.entries(ENDPOINT_SLO)) {
    const p95 = seg.endpoints[ep].p95;
    if (p95 !== undefined && satisfies(p95, slo[metric]) === false) {
      out.push(`${ep} p95 ${p95}ms > ${slo[metric].target}ms`);
    }
  }
  return out;
}

function violationsOf(slo, seg, targetRate, holdSec) {
  const reasons = latencyViolations(slo, seg);
  const err = errorRateOf(seg) || 0;
  if (satisfies(err, slo.error_rate) === false)
    reasons.push(`エラー率 ${round(err, 4)} ≥ ${slo.error_rate.target}`);
  const achieved = holdSec ? seg.requests / holdSec : null;
  if (targetRate && achieved !== null && achieved < targetRate * 0.95) {
    reasons.push(`達成 ${round(achieved, 1)} req/s < 目標 ${targetRate} req/s の 95%`);
  }
  return reasons;
}

export { violationsOf };

export function meanOf(values) {
  const v = values.filter((x) => x !== null && x !== undefined);
  return v.length ? mean(v) : null;
}
