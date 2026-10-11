// ④ soak: 想定負荷（既定 20 req/s）で長く流し、時間とともに悪化するか（メモリ・DB サイズ・応答時間）を見る。
// CI 短縮版は DURATION_SEC=600（10 分）。長時間版は DURATION_SEC=7200 などで。
// 件数増加と時間劣化を切り分けるため、追加と削除を同数にした balanced を既定にする（件数はほぼ一定）。
// bucket タグ（経過 60 秒ごと）で、時間に対する p95 の推移を verdict が見る。
import exec from "k6/execution";
import { check } from "k6";
import { buildSummary, countTasks, envInt, runOp, SUMMARY_TREND_STATS } from "./lib/common.js";

const RATE = envInt("RATE", 20);
const DURATION_SEC = envInt("DURATION_SEC", 600);
const MIN_TASKS = envInt("MIN_TASKS", 1000);
const MIX = __ENV.MIX || "balanced";

export const options = {
  scenarios: {
    soak: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: `${DURATION_SEC}s`,
      preAllocatedVUs: envInt("VUS", 10),
      maxVUs: envInt("MAX_VUS", 100),
      gracefulStop: "10s",
    },
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export function setup() {
  check(countTasks(), { [`事前データが ${MIN_TASKS} 件以上`]: (v) => v >= MIN_TASKS });
}

export default function () {
  const bucket = String(Math.floor(exec.instance.currentTestRunDuration / 60000));
  runOp(MIX, 1, { bucket });
}

export function handleSummary(data) {
  return buildSummary("soak", data, { RATE, DURATION_SEC, MIX });
}
