// warm-up: 低い到着率（既定 5 req/s）を DURATION_SEC（既定 30 秒）流して接続・JIT・SQLite のページキャッシュを温める。
// この実行の結果は判定に使わない（run.sh は summary を warmup/ に保存するだけ）。
import { buildSummary, envInt, runOp, SUMMARY_TREND_STATS } from "./lib/common.js";

export const options = {
  scenarios: {
    warmup: {
      executor: "constant-arrival-rate",
      rate: envInt("RATE", 5),
      timeUnit: "1s",
      duration: `${envInt("DURATION_SEC", 30)}s`,
      preAllocatedVUs: 5,
      maxVUs: 20,
    },
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export default function () {
  runOp("balanced", 1, { phase: "warmup" });
}

export function handleSummary(data) {
  return buildSummary("warmup", data, {});
}
