// 影響マップの陳腐化検査: 追跡ファイルが当たらない / 選ばれないケースがある / どのファイルにも当たらない glob。
import { globToRegExp } from "../../ci/lib/repo-fs.mjs";
import { CHANGE_KINDS, entriesFor } from "./impact.mjs";

export function unmappedFiles(map, files) {
  return files.filter((f) => entriesFor(map, f).length === 0);
}

export function neverSelectedCases(map, cases) {
  const ids = new Set([...(map.smoke_case_ids ?? []), ...map.entries.flatMap((e) => e.case_ids ?? [])]);
  const automated = cases.filter((c) => c.automation_layer !== "manual").map((c) => c.test_case_id);
  return automated.filter((id) => !ids.has(id));
}

export function unknownCaseIds(map, cases) {
  const known = new Set(cases.map((c) => c.test_case_id));
  const used = [...(map.smoke_case_ids ?? []), ...map.entries.flatMap((e) => e.case_ids ?? [])];
  return [...new Set(used.filter((id) => !known.has(id)))];
}

/** 追跡ファイルのどれにも当たらない glob（削除・改名後に残った古い定義）。 */
export function staleGlobs(map, files) {
  const all = [...map.entries, ...(map.no_test_impact ?? [])];
  return all.flatMap((e) =>
    e.paths.filter((g) => !files.some((f) => globToRegExp(g).test(f))).map((g) => `${e.id}: ${g}`),
  );
}

/** すべてのエントリに、決められた語彙の change_kind があること。 */
export function missingChangeKinds(map) {
  return [...map.entries, ...(map.no_test_impact ?? [])]
    .filter((e) => !CHANGE_KINDS.includes(e.change_kind))
    .map((e) => `${e.id}: change_kind が無い／不正（${e.change_kind ?? "未設定"}）`);
}

export function checkImpactMap({ map, files, cases }) {
  const unmapped = unmappedFiles(map, files);
  const never = neverSelectedCases(map, cases);
  const unknown = unknownCaseIds(map, cases);
  const stale = staleGlobs(map, files);
  const kinds = missingChangeKinds(map);
  const errors = [
    ...kinds,
    ...unmapped.map((f) => `影響マップに当たらない追跡ファイル: ${f}`),
    ...never.map((id) => `どのエントリからも選ばれない自動化ケース: ${id}`),
    ...unknown.map((id) => `cases.csv に無い TC-ID を参照: ${id}`),
  ];
  return {
    errors,
    warnings: stale.map((s) => `どの追跡ファイルにも当たらない glob: ${s}`),
    stats: {
      files: files.length,
      unmapped: unmapped.length,
      never_selected: never.length,
      stale_globs: stale.length,
      bad_change_kind: kinds.length,
    },
  };
}
