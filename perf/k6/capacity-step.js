// ⑤ capacity（1 ステップ）: 現在の件数のまま、想定負荷（既定 20 req/s）を STEP_SEC 秒流す。
// run.sh が seed.js で 1,000 → 2,500 → 5,000 → 7,500 → 10,000 と件数を増やしながら、各件数でこれを実行する。
// tasks タグ = 件数（env TASKS）。件数が増えると一覧取得（全件返す）が重くなる様子を見る。
import { check } from "k6";
import { buildSummary, countTasks, envInt, runOp, SUMMARY_TREND_STATS } from "./lib/common.js";

const RATE = envInt("RATE", 20);
const STEP_SEC = envInt("STEP_SEC", 60);
const TASKS = envInt("TASKS", 1000);

export const options = {
  scenarios: {
    capacity: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: `${STEP_SEC}s`,
      preAllocatedVUs: envInt("VUS", 10),
      maxVUs: envInt("MAX_VUS", 100),
      gracefulStop: "10s",
    },
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export function setup() {
  check(countTasks(), { [`事前データが ${TASKS} 件以上`]: (v) => v >= TASKS });
}

export default function () {
  runOp("model", TASKS, { tasks: String(TASKS) });
}

export function handleSummary(data) {
  return buildSummary("capacity", data, { RATE, STEP_SEC, TASKS });
}
