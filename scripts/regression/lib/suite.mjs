// 回帰スイート台帳（quality/regression-suite.csv）を docs/data/cases.csv などから生成する。
import { parseCsvObjects, toCsv } from "../../ci/lib/csv.mjs";
import { isFile, readText } from "../../ci/lib/repo-fs.mjs";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";

export const HEADER = [
  "case_id",
  "tier",
  "journey_id",
  "requirement_ids",
  "perspective_ids",
  "defect_ids",
  "automated",
  "manual_reason",
  "status",
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

export function buildRows({ cases, journeys, smokeIds, quarantinedIds, defects }) {
  const smoke = new Set(smokeIds);
  const byCase = journeyIndex(journeys);
  return cases.map((c) => ({
    case_id: c.test_case_id,
    tier: tierOf(c, smoke),
    journey_id: (byCase.get(c.test_case_id) ?? []).join(";"),
    requirement_ids: c.requirement_ids,
    perspective_ids: c.perspective_ids,
    defect_ids: (defects.get(c.test_case_id) ?? []).join(";"),
    automated: c.automation_layer === "manual" ? "no" : "yes",
    manual_reason: c.manual_reason,
    status: statusOf(c, quarantinedIds),
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

export function loadInputs(root) {
  const cases = parseCsvObjects(readText(root, "docs/data/cases.csv")).rows;
  const journeys = optionalYaml(root, "quality/journeys.yaml")?.journeys ?? [];
  const smokeIds = optionalYaml(root, "quality/impact-map.yaml")?.smoke_case_ids ?? [];
  const ledger = optionalYaml(root, "quality/flaky-ledger.yaml")?.entries ?? [];
  const quarantinedIds = new Set(ledger.flatMap((e) => String(e.test_id).match(TC) ?? []));
  return { cases, journeys, smokeIds, quarantinedIds, defects: loadDefectLinks(root) };
}

export function renderSuite(inputs) {
  return toCsv(HEADER, buildRows(inputs));
}
