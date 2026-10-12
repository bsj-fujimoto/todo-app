// scan-run.json（検査 1 回分の記録）の完全性の検査（純粋関数）。後から「何を・どの版のツールで・どの設定と閾値で・どこまで検査したか」を
// 読み取れない記録を、CI で止める。スキップ（status: skipped）は理由があれば許す（検査しなかったことの記録）。
const has = (v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
const nonEmptyList = (...lists) => lists.some((l) => Array.isArray(l) && l.length > 0);

/** 検査の種類のうち、対象にイメージ（digest）を持つもの。 */
const IMAGE_KINDS = new Set(["container"]);

function toolProblems(run) {
  return [
    !has(run.tool?.name) && "tool.name が無い",
    !has(run.tool?.version) && "tool.version が無い",
    !has(run.command) && "command が無い",
    !has(run.output_location) && "output_location が無い",
  ].filter(Boolean);
}

function configProblems(run) {
  return [
    !has(run.config_ref) &&
      !has(run.rules_ref) &&
      "config_ref と rules_ref のどちらも無い（設定・規則の出どころ）",
    !Array.isArray(run.exclusions) && "exclusions が無い（除外が無いなら「除外なし」と書く）",
    !has(run.thresholds) && "thresholds が無い",
  ].filter(Boolean);
}

function targetProblems(run) {
  const cov = run.coverage ?? {};
  return [
    !has(run.target?.commit_sha) && "target.commit_sha が無い",
    !nonEmptyList(cov.languages, cov.paths, cov.urls, cov.images) &&
      "coverage（languages / paths / urls / images）が空",
    IMAGE_KINDS.has(run.check_kind) &&
      !has(run.target?.image_digest) &&
      "target.image_digest が無い（イメージの検査）",
  ].filter(Boolean);
}

/** 1 つの scan-run の問題（文字列）の一覧。 */
export function scanRunProblems(run) {
  const label = run.scan ?? "(scan 名なし)";
  if (!has(run.check_kind)) return [`${label}: check_kind が無い`];
  if (run.status === "skipped")
    return has(run.skipped_reason) ? [] : [`${label}: スキップなのに skipped_reason が無い`];
  return [...toolProblems(run), ...configProblems(run), ...targetProblems(run)].map((p) => `${label}: ${p}`);
}

/** qc（scan-run の check_kind の語彙）。この外の値は、実際の検査内容に合わない分類になりやすい。 */
export const CHECK_KINDS = [
  "sast",
  "dast",
  "sca",
  "secret",
  "container",
  "iac",
  "config",
  "license",
  "seo",
  "maintainability",
  "performance",
  "framework",
  "other",
];

export const kindProblem = (run) =>
  CHECK_KINDS.includes(run.check_kind)
    ? []
    : [`${run.scan}: check_kind ${run.check_kind} は語彙（${CHECK_KINDS.join(" / ")}）に無い`];

export function checkScanRuns(runs) {
  return runs.flatMap((r) => [...kindProblem(r), ...scanRunProblems(r)]);
}
