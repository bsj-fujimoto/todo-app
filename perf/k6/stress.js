// ② stress: 到着率を段階的に上げ、SLO を割り始める点（限界点）と飽和の仕方を探す。SLO の合否は判定しない。
// 各段は「5 秒で到達 → STAGE_SEC 秒保持」。保持中のリクエストに stage タグ（到着率）を付け、段ごとの p95 を verdict が出す。
import exec from "k6/execution";
import { buildSummary, envInt, runOp, SUMMARY_TREND_STATS } from "./lib/common.js";

const STAGES = (__ENV.STAGES || "20,50,100,200,400,800").split(",").map((s) => parseInt(s, 10));
const STAGE_SEC = envInt("STAGE_SEC", 60);
const RAMP_SEC = 5;
const MIX = __ENV.MIX || "balanced";

export const options = {
  scenarios: {
    stress: {
      executor: "ramping-arrival-rate",
      startRate: STAGES[0],
      timeUnit: "1s",
      preAllocatedVUs: envInt("VUS", 50),
      maxVUs: envInt("MAX_VUS", 1000),
      gracefulStop: "15s",
      stages: STAGES.flatMap((r) => [
        { target: r, duration: `${RAMP_SEC}s` },
        { target: r, duration: `${STAGE_SEC}s` },
      ]),
    },
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

function stageTag() {
  const t = exec.instance.currentTestRunDuration / 1000;
  const slot = RAMP_SEC + STAGE_SEC;
  const idx = Math.min(Math.floor(t / slot), STAGES.length - 1);
  const within = t - idx * slot;
  return within < RAMP_SEC ? "ramp" : String(STAGES[idx]);
}

export default function () {
  runOp(MIX, 1, { stage: stageTag() });
}

export function handleSummary(data) {
  return buildSummary("stress", data, { STAGES: STAGES.join(","), STAGE_SEC, MIX });
}
