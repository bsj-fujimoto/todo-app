// 性能判定ロジックの単体テスト（node --test scripts/perf/test）。時刻・ネットワーク・ファイルに依存しない。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { latencyStats } from "../lib/analyze.mjs";
import { compareAll, compareMetric } from "../lib/compare-rules.mjs";
import { parsePercent, parseSize, parseStatsRecord } from "../lib/observe-parse.mjs";
import { judgeMetric, satisfies, verdictLoad } from "../lib/rules.mjs";
import { verdictCapacity } from "../lib/rules-scenarios.mjs";
import { percentile, trimTop, varianceStats } from "../lib/stats.mjs";

const SLO = {
  api_list_p95_ms: { metric: "api_list_p95_ms", operator: "<=", target: 500, unit: "ms" },
  error_rate: { metric: "error_rate", operator: "<", target: 0.01, unit: "ratio" },
  throughput_rps: { metric: "throughput_rps", operator: ">=", target: 0.95, unit: "ratio_of_target_rate" },
};

describe("stats", () => {
  it("percentile は k6 と同じ線形補間", () => {
    assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
    assert.equal(percentile([10, 20], 0.95), 19.5);
    assert.equal(percentile([], 0.95), null);
  });

  it("varianceStats は平均・標準偏差・95% 信頼区間（t 分布）を返す", () => {
    const v = varianceStats([10, 12, 14]);
    assert.equal(v.mean, 12);
    assert.equal(v.sd, 2);
    // t(0.975, df=2) = 4.303、半幅 = 4.303 * 2 / sqrt(3)
    assert.ok(Math.abs(v.ci95[1] - (12 + (4.303 * 2) / Math.sqrt(3))) < 1e-9);
    assert.equal(varianceStats([5]).ci95, null);
  });

  it("trimTop は n >= 100 のとき上位 0.1% を外れ値として除く", () => {
    const values = Array.from({ length: 1000 }, (_, i) => i + 1);
    const { kept, dropped } = trimTop(values);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0], 1000);
    assert.equal(kept.length, 999);
    assert.equal(trimTop([1, 2, 3]).dropped.length, 0, "n < 100 では除かない");
  });
});

describe("latencyStats", () => {
  it("外れ値を除いた p95 と、除かない raw_p95 を併記する", () => {
    const values = [...Array.from({ length: 999 }, () => 10), 5000];
    const s = latencyStats(values);
    assert.equal(s.p95, 10);
    assert.equal(s.dropped_outliers, 1);
    assert.equal(s.max, 5000);
    assert.equal(s.raw_p95, 10);
  });
});

describe("judge", () => {
  it("satisfies は演算子を解釈する", () => {
    assert.equal(satisfies(500, SLO.api_list_p95_ms), true);
    assert.equal(satisfies(501, SLO.api_list_p95_ms), false);
    assert.equal(satisfies(0.01, SLO.error_rate), false, "< は境界を含まない");
    assert.equal(satisfies(0.96, SLO.throughput_rps), true);
  });

  it("3 反復の平均が目標内なら pass。反復の 1 つが超えると warning を残す", () => {
    const j = judgeMetric(SLO.api_list_p95_ms, [100, 120, 520]);
    assert.equal(j.pass, true);
    assert.ok(j.warnings.some((w) => w.includes("1 / 3")));
  });

  it("平均が目標を超えたら fail", () => {
    assert.equal(judgeMetric(SLO.api_list_p95_ms, [600, 700, 800]).pass, false);
  });

  it("verdictLoad は SLO のうち測れた指標を判定し、測れないものは not_judged_here に出す", () => {
    const seg = {
      endpoints: { list: { p95: 50, p99: 80 }, create: {}, toggle: {}, delete: {} },
      error_rate: 0,
      check_fail_rate: 0,
      throughput_ratio: 1,
    };
    const its = [1, 2, 3].map(() => ({ segments: { main: seg }, observe: null }));
    const v = verdictLoad(SLO, its);
    assert.equal(v.status, "pass");
    assert.deepEqual(v.slo_judgements.map((j) => j.metric).sort(), [
      "api_list_p95_ms",
      "error_rate",
      "throughput_rps",
    ]);
  });
});

describe("compare（退行検出）", () => {
  const cfg = { regression_threshold_pct: 20, min_abs_delta: { ms: 5, ratio: 0.001, other: 0 }, metrics: {} };

  it("+20% 超かつ絶対差が下限以上なら退行", () => {
    assert.equal(compareMetric("load.api_list_p95_ms", 100, 125, cfg).regressed, true);
    assert.equal(compareMetric("load.api_list_p95_ms", 100, 119, cfg).regressed, false);
  });

  it("数 ms の差は割合が大きくても退行にしない（ノイズ除け）", () => {
    assert.equal(compareMetric("load.api_list_p95_ms", 3, 4, cfg).regressed, false);
  });

  it("大きいほど良い指標は低下を退行とみなす", () => {
    assert.equal(compareMetric("stress.max_sustained_rps", 200, 100, cfg).regressed, true);
    assert.equal(compareMetric("stress.max_sustained_rps", 200, 300, cfg).regressed, false);
  });

  it("同じ指標名だけを比べる", () => {
    const r = compareAll({ a_ms: 100, b_ms: 100 }, { a_ms: 200, c_ms: 1 }, cfg);
    assert.equal(r.compared, 1);
    assert.deepEqual(r.only_in_baseline, ["b_ms"]);
    assert.equal(r.regressions.length, 1);
  });
});

describe("docker stats の解析", () => {
  it("単位付きの文字列をバイト・% に直す", () => {
    assert.equal(parseSize("20.5MiB"), Math.round(20.5 * 1024 ** 2));
    assert.equal(parseSize("1GB"), 1e9);
    assert.equal(parsePercent("12.50%"), 12.5);
    assert.equal(parseSize("abc"), null);
  });

  it("1 行の記録を共通形式にする", () => {
    const r = parseStatsRecord(
      { CPUPerc: "3.0%", MemUsage: "30MiB / 512MiB", NetIO: "1kB / 2kB", PIDs: "11" },
      "backend",
    );
    assert.equal(r.service, "backend");
    assert.equal(r.cpu_pct, 3);
    assert.equal(r.mem_bytes, 30 * 1024 ** 2);
    assert.equal(r.pids, 11);
  });
});

describe("timeline（spike の回復）", () => {
  it("timeToRecover は、以降ずっと SLO 内に戻る最初の区間を返す。戻らなければ null", async () => {
    const { timeToRecover } = await import("../lib/timeline.mjs");
    const b = (t, p95, err = 0) => ({ t_sec: t, requests: 50, list_p95: p95, error_rate: err });
    assert.equal(timeToRecover([b(0, 3000), b(5, 900), b(10, 20), b(15, 18)], 500, 0.01), 10);
    assert.equal(
      timeToRecover([b(0, 20), b(5, 3000), b(10, 20)], 500, 0.01),
      10,
      "途中で悪化したら、その後の戻りから数える",
    );
    assert.equal(timeToRecover([b(0, 20), b(5, 30), b(10, 4000)], 500, 0.01), null);
    assert.equal(
      timeToRecover([b(0, 20), b(5, 30, 0.2)], 500, 0.01),
      null,
      "エラー率が高い区間も戻っていない",
    );
  });
});

describe("capacity の判定範囲", () => {
  const SLO_ALL = {
    ...SLO,
    api_create_p95_ms: { metric: "api_create_p95_ms", operator: "<=", target: 300, unit: "ms" },
    api_update_p95_ms: { metric: "api_update_p95_ms", operator: "<=", target: 300, unit: "ms" },
    api_delete_p95_ms: { metric: "api_delete_p95_ms", operator: "<=", target: 300, unit: "ms" },
  };
  const seg = (p95) => ({
    requests: 100,
    error_rate: 0,
    check_fail_rate: 0,
    endpoints: { list: { p95 }, create: { p95: 10 }, toggle: { p95: 10 }, delete: { p95: 10 } },
  });
  const its = (a, b) => [{ segments: { "step-1000": seg(a), "step-7500": seg(b) } }];

  it("SLO の適用範囲（1,000 件）を超える件数の違反は警告で、fail にしない", () => {
    const v = verdictCapacity(SLO_ALL, its(10, 1500), [1000, 7500], 1000);
    assert.equal(v.status, "pass");
    assert.equal(v.warnings.length, 1);
    assert.equal(v.max_tasks_within_slo, 1000);
  });

  it("適用範囲の中で SLO を超えたら fail", () => {
    const v = verdictCapacity(SLO_ALL, its(900, 1500), [1000, 7500], 1000);
    assert.equal(v.status, "fail");
  });
});
