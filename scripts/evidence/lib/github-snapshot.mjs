// 不具合 Issue のスナップショット（docs/evidence/github/defect-issues.json）。Issue は後から変わるので、生成の入力を
// 取得時点の写しとしてコミットし、それを証拠（EV）にする。オフラインでも同じ defects.csv を再生成できる。純粋関数。
import { extractFields } from "./defects.mjs";

export const SNAPSHOT_FILE = "docs/evidence/github/defect-issues.json";

/** gh issue list の 1 件 → スナップショットの 1 件（コメントは日時と本文だけ。投稿者は残さない）。 */
export const toSnapshotIssue = (issue) => ({
  number: issue.number,
  title: issue.title,
  url: issue.url,
  state: issue.state,
  stateReason: issue.stateReason ?? null,
  labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name)).sort(),
  createdAt: issue.createdAt,
  closedAt: issue.closedAt ?? null,
  body: issue.body ?? "",
  comments: (issue.comments ?? []).map((c) => ({ createdAt: c.createdAt, body: c.body })),
});

export function buildSnapshot({ repository, issues, fixPrs, releases }) {
  return {
    schema_version: 1,
    repository,
    query: "label:defect または label:flaky（state: all）",
    issues: issues.map(toSnapshotIssue),
    fix_prs: fixPrs,
    releases,
  };
}

/** 取得し直した内容が、コミット済みのスナップショットと同じか（同じなら書き換えない＝取得時刻も動かさない）。 */
export const sameContent = (a, b) =>
  Boolean(a) &&
  JSON.stringify([a.issues, a.fix_prs, a.releases]) === JSON.stringify([b.issues, b.fix_prs, b.releases]);

/** Issue 本文の「修正 PR: #N」の番号（マージ commit の取得対象）。 */
export const fixPrNumbers = (issues) => [
  ...new Set(issues.map((i) => extractFields(i).fix_pr).filter(Boolean)),
];
