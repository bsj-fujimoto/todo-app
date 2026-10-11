// 変更影響マップ（quality/impact-map.yaml）の読込と、変更ファイル → 実行する TC-ID の選択。
import { parseCsvObjects } from "../../ci/lib/csv.mjs";
import { globToRegExp, readText } from "../../ci/lib/repo-fs.mjs";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";

const caseIdRe = /^TC-\d{3}$/;

/** 変更の種類（impact-map の change_kind）。backend の store / migration は db、openapi.yaml は api、compose・Dockerfile・CI は infra。 */
export const CHANGE_KINDS = ["code", "config", "db", "api", "infra", "docs"];

export function loadImpactMap(root) {
  const map = parseYaml(readText(root, "quality/impact-map.yaml"));
  const problems = validateMap(map);
  if (problems.length) throw new Error(`impact-map.yaml が不正: ${problems.join(" / ")}`);
  return map;
}

export function loadCases(root) {
  return parseCsvObjects(readText(root, "docs/data/cases.csv")).rows;
}

const kindProblems = (e) =>
  e.change_kind && !CHANGE_KINDS.includes(e.change_kind)
    ? [`${e.id}: 不正な change_kind ${e.change_kind}（${CHANGE_KINDS.join("/")}）`]
    : [];

function validateEntry(e) {
  const out = (e.case_ids ?? []).filter((c) => !caseIdRe.test(c)).map((c) => `${e.id}: 不正な TC-ID ${c}`);
  if (!e.id) out.push("id の無いエントリがある");
  if (!Array.isArray(e.paths) || e.paths.length === 0) out.push(`${e.id}: paths が空`);
  if (!e.feature && !e.reason) out.push(`${e.id}: feature か reason が無い`);
  return [...out, ...kindProblems(e)];
}

export function validateMap(map) {
  if (!map || !Array.isArray(map.entries)) return ["entries が無い"];
  const out = (map.smoke_case_ids ?? [])
    .filter((c) => !caseIdRe.test(c))
    .map((c) => `smoke に不正な ID ${c}`);
  const ids = map.entries.map((e) => e.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) out.push(`id の重複: ${[...new Set(dup)].join(",")}`);
  return [...out, ...map.entries.flatMap(validateEntry)];
}

/** 1 ファイルに当たるエントリ（通常エントリ + テスト影響なし）。 */
export function entriesFor(map, file) {
  const all = [...map.entries, ...(map.no_test_impact ?? [])];
  return all.filter((e) => e.paths.some((g) => globToRegExp(g).test(file)));
}

const layerOf = (cases) => new Map(cases.map((c) => [c.test_case_id, c.automation_layer]));

function mapFiles(map, files) {
  return files.map((file) => ({ file, entries: entriesFor(map, file) }));
}

function riskReport(cases, selected) {
  const sel = new Set(selected);
  const byRisk = new Map();
  for (const c of cases.filter((x) => x.automation_layer !== "manual")) {
    for (const r of c.risk_ids.split(";").filter(Boolean)) {
      const v = byRisk.get(r) ?? { risk_id: r, total_cases: 0, excluded_cases: [] };
      v.total_cases += 1;
      if (!sel.has(c.test_case_id)) v.excluded_cases.push(c.test_case_id);
      byRisk.set(r, v);
    }
  }
  return [...byRisk.values()]
    .filter((v) => v.excluded_cases.length > 0)
    .sort((a, b) => a.risk_id.localeCompare(b.risk_id));
}

const alt = (ids) => `\\[(?:${ids.join("|")})\\]`;

/** e2e の --grep（Playwright）と node:test の名前パターン。該当ケースが無い層は @smoke / 空パターンで受ける。 */
export function patterns(selected, cases) {
  const layer = layerOf(cases);
  const e2e = selected.filter((id) => layer.get(id) === "e2e");
  const unitApi = selected.filter((id) => ["unit", "api"].includes(layer.get(id)));
  return {
    grep_e2e: e2e.length ? `${alt(e2e)}|@smoke` : "@smoke",
    name_pattern_unit_api: unitApi.length ? alt(unitApi) : "^$",
  };
}

function fullResult(base, cases, reason) {
  const all = cases.filter((c) => c.automation_layer !== "manual").map((c) => c.test_case_id);
  return {
    ...base,
    mode: "full",
    selection_reason: reason,
    selected_case_ids: all,
    excluded_risks: [],
    grep_e2e: "",
    name_pattern_unit_api: "",
  };
}

export function select({ map, files, cases }) {
  const mapped = mapFiles(map, files);
  const unmapped = mapped.filter((m) => m.entries.length === 0).map((m) => m.file);
  const base = {
    changed_files: files,
    mapped: mapped.map((m) => ({ file: m.file, entries: m.entries.map((e) => e.id) })),
    unmapped_paths: unmapped,
    change_kinds: [
      ...new Set(mapped.flatMap((m) => m.entries.map((e) => e.change_kind)).filter(Boolean)),
    ].sort(),
  };
  const fullEntries = [
    ...new Set(
      mapped
        .flatMap((m) => m.entries)
        .filter((e) => e.full)
        .map((e) => e.id),
    ),
  ];
  if (files.length === 0)
    return fullResult(base, cases, ["変更ファイルを特定できない（差分が空）。安全側で全件実行"]);
  if (unmapped.length)
    return fullResult(base, cases, [`影響マップに無いパスの変更があるため全件実行: ${unmapped.join(", ")}`]);
  if (fullEntries.length)
    return fullResult(base, cases, [`全件実行を要求するエントリに該当: ${fullEntries.join(", ")}`]);
  return selectedResult({ base, mapped, map, cases });
}

function selectedResult({ base, mapped, map, cases }) {
  const entries = [...new Map(mapped.flatMap((m) => m.entries).map((e) => [e.id, e])).values()];
  const ids = new Set([...(map.smoke_case_ids ?? []), ...entries.flatMap((e) => e.case_ids ?? [])]);
  const known = new Set(cases.filter((c) => c.automation_layer !== "manual").map((c) => c.test_case_id));
  const selected = [...ids].filter((id) => known.has(id)).sort();
  const reason = [
    ...mapped.map((m) => `${m.file} → ${m.entries.map((e) => e.id).join(", ")}`),
    `常時実行（smoke）: ${(map.smoke_case_ids ?? []).join(", ")}`,
  ];
  return {
    ...base,
    mode: "selected",
    selection_reason: reason,
    selected_case_ids: selected,
    excluded_risk_notes: entries
      .filter((e) => e.excluded_risk)
      .map((e) => ({ entry: e.id, note: e.excluded_risk })),
    excluded_risks: riskReport(cases, selected),
    ...patterns(selected, cases),
  };
}
