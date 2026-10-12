// 監視設定の整合性検査（CLI）。monitors.yaml・alert-routes.yaml・runbooks/index.yaml・perf/slo.yaml の突き合わせ。
// 使い方: node scripts/monitoring/check-config.mjs   （問題があれば一覧を出して終了コード 1）
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { checkConfig } from "./lib/config-check.mjs";

const readYaml = (p) => parse(readFileSync(p, "utf8"));
const JOURNEYS = ["J-01", "J-02", "J-03", "J-04", "J-05"]; // 重要ジャーニー（monitoring/README.md）

const problems = checkConfig({
  monitorsDoc: readYaml("monitoring/monitors.yaml"),
  routes: readYaml("monitoring/alert-routes.yaml"),
  runbooksDoc: readYaml("monitoring/runbooks/index.yaml"),
  slo: readYaml("perf/slo.yaml"),
  journeys: JOURNEYS,
  workflowDoc: readYaml(".github/workflows/synthetic.yml"),
  read: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
});

if (problems.length === 0) {
  console.log("[check-config] OK");
} else {
  for (const p of problems) console.error(`[check-config] ${p}`);
  process.exit(1);
}
