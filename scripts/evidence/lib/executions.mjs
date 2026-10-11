// 実施表（docs/data/executions.csv）の行を、JUnit と観察値から組み立てる。1 行 = 1 ケース × 1 実行環境 × 1 run。純粋関数。
// 期待結果の転記はしない（actual_result は観察値から）。観察できなかったことは「できなかった」と書く。
import { groupBy, uniq } from "./common.mjs";
import { clipText, actualResultOf } from "./observations.mjs";
import { tcIdsOf } from "./junit-suites.mjs";

export const EXECUTION_COLUMNS = [
  "execution_id",
  "test_case_id",
  "kind",
  "run_ref",
  "commit_sha",
  "environment",
  "status",
  "actual_result",
  "evidence_ids",
  "defect_ids",
  "executed_at",
  "executor",
  "reason",
  "owner",
  "retest_due",
];

const STATUS = { passed: "pass", failed: "fail", skipped: "skipped" };
const LAYER_ORDER = ["e2e", "compose", "api", "contract", "unit"];

/** JUnit のケース → { layer, component, project, label }。ファイル名（取り込み時の規則）とケースのパスで決める。 */
const SOURCE_RULES = [
  [
    /contract-junit\.xml$/,
    () => ({ layer: "contract", component: "backend", project: null, label: "contract" }),
  ],
  [/compose-junit\.xml$/, (project) => ({ layer: "compose", component: "e2e", project, label: "compose" })],
  [/^junit\/e2e-/, (project) => ({ layer: "e2e", component: "e2e", project, label: `e2e/${project}` })],
  [
    /frontend-junit\.xml$/,
    () => ({ layer: "unit", component: "frontend", project: null, label: "unit(frontend)" }),
  ],
];

const projectOf = (c) => c.hostname || /^junit\/e2e-(.+)-junit\.xml$/.exec(c.source)?.[1] || null;

export function classify(c) {
  const rule = SOURCE_RULES.find(([re]) => re.test(c.source));
  if (rule) return rule[1](projectOf(c));
  const unit = /\/test\/unit\//.test(c.file);
  return {
    layer: unit ? "unit" : "api",
    component: "backend",
    project: null,
    label: unit ? "unit(backend)" : "api",
  };
}

/** ケースを TC × 環境ごとにまとめる。TC-ID の無いテストは対象外。 */
export function groupCases(junitCases) {
  const groups = new Map();
  for (const c of junitCases) {
    const where = classify(c);
    for (const tc of tcIdsOf(c.name)) {
      const key = `${tc}|${where.layer}|${where.component}|${where.project ?? ""}`;
      const g = groups.get(key) ?? { tc, ...where, cases: [] };
      g.cases.push(c);
      groups.set(key, g);
    }
  }
  return [...groups.values()];
}

export function combineStatus(cases) {
  const statuses = uniq(cases.map((c) => STATUS[c.status]));
  if (statuses.includes("fail")) return "fail";
  return statuses.every((s) => s === "skipped") ? "skipped" : "pass";
}

// node:test の JUnit は引用符などを二重に実体参照化する（&amp;quot;）。一度デコードしても残る分を戻して比べる。
export const normalizeName = (name) =>
  String(name)
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const entryLayer = (layer) => (layer === "contract" ? "api" : layer);

/** グループに対応する観察 entry（同じ component・TC・project・層で、タイトルがテスト名に含まれるもの）。 */
export function matchEntries(group, observations) {
  return (observations.get(group.component) ?? []).filter(
    (e) =>
      e._tc === group.tc &&
      e.layer === entryLayer(group.layer) &&
      (group.project === null || e.project === group.project) &&
      group.cases.some((c) => normalizeName(c.name).includes(normalizeName(e.title))),
  );
}

export function environmentText(label, entries) {
  const env = entries[0]?.environment;
  const view = env?.viewport ? `${env.viewport.width}x${env.viewport.height}` : null;
  return [label, env?.browser, view, env?.os, env?.node ? `Node ${env.node}` : null]
    .filter(Boolean)
    .join(" / ");
}

const seconds = (cases) => Math.round(cases.reduce((sum, c) => sum + c.time, 0) * 1000) / 1000;

/** 実測の文。観察値が無いときは、無かったと書き、JUnit が記録した事実（件数・結果・所要）だけを添える。 */
export function actualResultFor(group, entries, status) {
  const observed = actualResultOf(entries);
  const failure = group.cases.find((c) => c.status === "failed")?.message;
  const tail = failure ? ` 失敗の内容: ${failure}` : "";
  if (observed) return clipText(`${observed}${tail}`, 760);
  const junit = `JUnit は ${group.cases.length} 件が ${status}、所要 ${seconds(group.cases)} 秒`;
  return `観察値なし（この run の artifact に観察値が無い）。${junit}${tail}`;
}

export const executedAtOf = (group, entries, fallback) => {
  const times = entries
    .map((e) => e.started_at)
    .filter(Boolean)
    .sort();
  return times[0] ?? group.cases.find((c) => c.timestamp)?.timestamp ?? fallback ?? "";
};

/** 行のソート: TC → 層 → 環境。 */
export const compareRows = (a, b) =>
  a.test_case_id.localeCompare(b.test_case_id) ||
  LAYER_ORDER.indexOf(a._layer ?? "") - LAYER_ORDER.indexOf(b._layer ?? "") ||
  a.environment.localeCompare(b.environment);

export const groupRowsByCase = (rows) => groupBy(rows, (r) => r.test_case_id);
