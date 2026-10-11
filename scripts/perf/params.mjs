// run.sh に渡すパラメータを perf/slo.yaml・perf/workload.yaml から取り出す（値を bash に複製しない）。
//   node scripts/perf/params.mjs slo               → k6 の SLO_JSON（{ メトリクス名: target }）
//   node scripts/perf/params.mjs profile <profile> → シェルで eval できる KEY=value の行（full | ci | quick）
// SOAK_DURATION_SEC / LOAD_DURATION_SEC など同名の環境変数があれば、その値を優先する（長時間版 soak など）。
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const slo = parse(readFileSync("perf/slo.yaml", "utf8"));
const wl = parse(readFileSync("perf/workload.yaml", "utf8"));

function profileLines(profile) {
  const sc = wl.scenarios;
  const pick = (obj) => {
    if (!(profile in obj)) throw new Error(`未知の profile: ${profile}`);
    return obj[profile];
  };
  const env = (name, fallback) => process.env[name] || String(fallback);
  return {
    WARMUP_SEC: wl.warmup.duration_sec,
    WARMUP_RPS: 5,
    LOAD_RPS: wl.arrival_rate.load_rps,
    LOAD_DURATION_SEC: env("LOAD_DURATION_SEC", pick(sc.load.duration_sec)),
    STRESS_STAGES: sc.stress.stages_rps.join(","),
    STRESS_STAGE_SEC: env("STRESS_STAGE_SEC", pick(sc.stress.stage_duration_sec)),
    SPIKE_DURATION_SEC: env("SPIKE_DURATION_SEC", pick(sc.spike.duration_sec)),
    SOAK_DURATION_SEC: env("SOAK_DURATION_SEC", pick(sc.soak.duration_sec)),
    CAPACITY_STEPS: sc.capacity.steps_tasks.join(" "),
    CAPACITY_STEP_SEC: env("CAPACITY_STEP_SEC", pick(sc.capacity.step_measure_sec)),
    CAPACITY_RPS: sc.capacity.rps,
    NORMAL_TASKS: wl.data_volume.normal_tasks,
    ITERATIONS: wl.iterations,
  };
}

const [kind, profile] = process.argv.slice(2);
if (kind === "slo") {
  const out = {};
  for (const s of slo.slos) out[s.metric] = s.target;
  process.stdout.write(`${JSON.stringify(out)}\n`);
} else if (kind === "profile") {
  for (const [k, v] of Object.entries(profileLines(profile || "full"))) process.stdout.write(`${k}="${v}"\n`);
} else {
  process.stderr.write("usage: params.mjs slo | profile <full|ci|quick>\n");
  process.exit(2);
}
