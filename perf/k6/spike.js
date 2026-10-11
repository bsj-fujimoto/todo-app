// ③ spike: 急な到着率の跳ね上がり（BASE → SPIKE を 10 秒で）と、その後の回復を見る。
// phase タグ: base（前）/ rampup / spike / rampdown / recovery（後）。回復後の p95 が base に戻るかを verdict が見る。
import exec from "k6/execution";
import { buildSummary, envInt, runOp, SUMMARY_TREND_STATS } from "./lib/common.js";

const BASE = envInt("BASE_RPS", 20);
const SPIKE = envInt("SPIKE_RPS", 400);
const DURATION_SEC = envInt("DURATION_SEC", 180);
const MIX = __ENV.MIX || "balanced";
const f = DURATION_SEC / 180;
const sec = (s) => Math.max(1, Math.round(s * f));
const PHASES = [
  ["base", sec(30), BASE],
  ["rampup", 10, SPIKE],
  ["spike", sec(60), SPIKE],
  ["rampdown", 10, BASE],
  ["recovery", sec(70), BASE],
];

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-arrival-rate",
      startRate: BASE,
      timeUnit: "1s",
      preAllocatedVUs: envInt("VUS", 50),
      maxVUs: envInt("MAX_VUS", 1000),
      gracefulStop: "15s",
      stages: PHASES.map(([, d, target]) => ({ target, duration: `${d}s` })),
    },
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
};

function phaseTag() {
  const t = exec.instance.currentTestRunDuration / 1000;
  let acc = 0;
  for (const [name, d] of PHASES) {
    acc += d;
    if (t < acc) return name;
  }
  return "recovery";
}

export default function () {
  runOp(MIX, 1, { phase: phaseTag() });
}

export function handleSummary(data) {
  const phases = PHASES.map((p) => `${p[0]}:${p[1]}`).join(",");
  return buildSummary("spike", data, { BASE, SPIKE, DURATION_SEC, MIX, PHASES: phases });
}
