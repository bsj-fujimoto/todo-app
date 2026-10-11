// ① load: 想定負荷（perf/workload.yaml の load_rps、既定 20 req/s）を定常で流し、SLO を判定する。
// 開始前に DS-006（1,000 件）を seed.js で投入しておく（run.sh が行う）。
import { check } from "k6";
import {
  buildSummary,
  countTasks,
  envInt,
  loadSlo,
  runOp,
  sloThresholds,
  SUMMARY_TREND_STATS,
} from "./lib/common.js";

const RATE = envInt("RATE", 20);
const DURATION_SEC = envInt("DURATION_SEC", 300);
const MIN_TASKS = envInt("MIN_TASKS", 1000);

export const options = {
  scenarios: {
    load: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: `${DURATION_SEC}s`,
      preAllocatedVUs: envInt("VUS", 10),
      maxVUs: envInt("MAX_VUS", 100),
      gracefulStop: "10s",
    },
  },
  thresholds: sloThresholds(loadSlo()),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export function setup() {
  const n = countTasks();
  check(n, { [`事前データが ${MIN_TASKS} 件以上`]: (v) => v >= MIN_TASKS });
  return { tasksAtStart: n };
}

export default function () {
  runOp("model", MIN_TASKS);
}

export function handleSummary(data) {
  return buildSummary("load", data, { RATE, DURATION_SEC, MIN_TASKS });
}
