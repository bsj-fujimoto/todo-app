// 回帰スイート台帳（quality/regression-suite.csv）を docs/data/cases.csv などから生成する。
import { createHash } from "node:crypto";
import { parseCsvObjects, toCsv } from "../../ci/lib/csv.mjs";
import { isFile, readText } from "../../ci/lib/repo-fs.mjs";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";
import { tiersOf, workflowTiers } from "./tiers.mjs";

export const HEADER = [
  "case_id",
  "tier",
  "tiers",
  "journey_id",
  "requirement_ids",
  "perspective_ids",
  "defect_ids",
  "automated",
  "manual_reason",
  "status",
  "last_run_at",
  "last_run_ids",
  "environment",
  "steps_hash",
  "last_result",
];
const TC = /TC-\d{3}/g;
const optionalYaml = (root, rel) => (isFile(root, rel) ? parseYaml(readText(root, rel)) : null);

/** docs/data/defects.csv があれば、欠陥 → 再現・回帰ケースの対応を読む（無ければ空）。 */
export function loadDefectLinks(root) {
  const links = new Map();
  if (!isFile(root, "docs/data/defects.csv")) return links;
  const { header, rows } = parseCsvObjects(readText(root, "docs/data/defects.csv"));
  const idCol = header.find((h) => /^(defect_id|id)$/.test(h));
  const caseCols = header.filter((h) => /case/i.test(h));
  for (const r of rows) {
    for (const tc of caseCols.flatMap((c) => r[c].match(TC) ?? [])) {
      links.set(tc, [...(links.get(tc) ?? []), r[idCol]]);
    }
  }
  return links;
}

/** docs/data/executions.csv があれば、ケースごとの実施履歴を読む（無ければ空）。 */
export function loadExecutions(root) {
  const byCase = new Map();
  if (!isFile(root, "docs/data/executions.csv")) return byCase;
  for (const r of parseCsvObjects(readText(root, "docs/data/executions.csv")).rows) {
    byCase.set(r.test_case_id, [...(byCase.get(r.test_case_id) ?? []), r]);
  }
  return byCase;
}

/** 手順（cases.csv の action）の短いハッシュ。手順が変わったのに実施結果が古いままのケースを見つける目印。 */
export const stepsHash = (action) =>
  createHash("sha256")
    .update(String(action ?? "").trim())
    .digest("hex")
    .slice(0, 12);

const shortEnv = (env) => String(env).split(" / ")[0];
const RESULT_ORDER = ["fail", "blocked", "skipped", "pass"];

function aggregate(statuses) {
  return RESULT_ORDER.find((s) => statuses.includes(s)) ?? statuses[0] ?? "not_run";
}

/** そのケースの最新の実施（run_ref 単位）の要約。実施が無い（not_run のみ）なら空欄と not_run。 */
export function lastRunOf(executions) {
  const done = (executions ?? []).filter((e) => e.status !== "not_run" && e.executed_at);
  if (done.length === 0)
    return { last_run_at: "", last_run_ids: "", environment: "", last_result: "not_run" };
  const newest = [...done].sort((a, b) => b.executed_at.localeCompare(a.executed_at));
  const latestRef = newest[0].run_ref;
  const latest = done.filter((e) => e.run_ref === latestRef);
  const refs = [...new Set(newest.map((e) => e.run_ref))].slice(0, 3);
  return {
    last_run_at: newest[0].executed_at,
    last_run_ids: refs.join(";"),
    environment: [...new Set(latest.map((e) => shortEnv(e.environment)))].sort().join(";"),
    last_result: aggregate(latest.map((e) => e.status)),
  };
}

export function tierOf(c, smoke) {
  if (c.automation_layer === "manual") return "manual";
  if (smoke.has(c.test_case_id)) return "smoke";
  return c.priority === "low" ? "daily" : "pr";
}

function journeyIndex(journeys) {
  const idx = new Map();
  for (const j of journeys) for (const id of j.case_ids ?? []) idx.set(id, [...(idx.get(id) ?? []), j.id]);
  return idx;
}

function statusOf(c, quarantined) {
  if (c.automation_layer === "manual") return "manual";
  return quarantined.has(c.test_case_id) ? "quarantined" : "active";
}

export function buildRows({
  cases,
  journeys,
  smokeIds,
  quarantinedIds,
  defects,
  executions = new Map(),
  availableTiers = [],
  selectableIds = new Set(),
}) {
  const smoke = new Set(smokeIds);
  const byCase = journeyIndex(journeys);
  return cases.map((c) => ({
    case_id: c.test_case_id,
    tier: tierOf(c, smoke),
    // 実行される層（;区切り）。pr は変更影響の選択の対象（impact-map・smoke）のときだけ。全件の層（main・daily・weekly・release）は全自動化ケース
    tiers: tiersOf(
      {
        automated: c.automation_layer !== "manual",
        selectable: smoke.has(c.test_case_id) || selectableIds.has(c.test_case_id),
      },
      availableTiers,
    ).join(";"),
    journey_id: (byCase.get(c.test_case_id) ?? []).join(";"),
    requirement_ids: c.requirement_ids,
    perspective_ids: c.perspective_ids,
    defect_ids: (defects.get(c.test_case_id) ?? []).join(";"),
    automated: c.automation_layer === "manual" ? "no" : "yes",
    manual_reason: c.manual_reason,
    status: statusOf(c, quarantinedIds),
    ...lastRunOf(executions.get(c.test_case_id)),
    steps_hash: stepsHash(c.action),
  }));
}

function journeyProblems(j, byId) {
  const ids = j.case_ids ?? [];
  const out = ["id", "name", "owner", "on_failure"]
    .filter((k) => !j[k])
    .map((k) => `${j.id ?? "?"}: ${k} が無い`);
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) out.push(`${j.id}: cases.csv に無いケース ${missing.join(",")}`);
  const automated = ids.filter((id) => byId.has(id) && byId.get(id).automation_layer !== "manual");
  if (automated.length === 0) out.push(`${j.id}: 自動化済みのケースが 1 つも無い（常時保護できない）`);
  return out;
}

export function validateJourneys({ journeys, cases }) {
  const byId = new Map(cases.map((c) => [c.test_case_id, c]));
  return journeys.flatMap((j) => journeyProblems(j, byId));
}

/** 層の導出に使うワークフロー（トリガーを読む）。 */
function loadWorkflows(root) {
  const read = (n) =>
    isFile(root, `.github/workflows/${n}`) ? readText(root, `.github/workflows/${n}`) : null;
  return Object.fromEntries(["ci.yml", "nightly.yml", "release.yml"].map((n) => [n, read(n)]));
}

/** impact-map の smoke と、変更影響の選択の対象（どれかのエントリに載っているケース）。 */
function loadImpact(root) {
  const impact = optionalYaml(root, "quality/impact-map.yaml") ?? {};
  return {
    smokeIds: impact.smoke_case_ids ?? [],
    selectableIds: new Set((impact.entries ?? []).flatMap((e) => e.case_ids ?? [])),
  };
}

function loadQuarantined(root) {
  const ledger = optionalYaml(root, "quality/flaky-ledger.yaml")?.entries ?? [];
  return new Set(ledger.flatMap((e) => String(e.test_id).match(TC) ?? []));
}

export function loadInputs(root) {
  return {
    cases: parseCsvObjects(readText(root, "docs/data/cases.csv")).rows,
    journeys: optionalYaml(root, "quality/journeys.yaml")?.journeys ?? [],
    ...loadImpact(root),
    quarantinedIds: loadQuarantined(root),
    availableTiers: workflowTiers(loadWorkflows(root)),
    defects: loadDefectLinks(root),
    executions: loadExecutions(root),
  };
}

export function renderSuite(inputs) {
  return toCsv(HEADER, buildRows(inputs));
}
