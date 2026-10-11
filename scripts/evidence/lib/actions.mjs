// アクション表（docs/data/actions.csv）の様式と検査。中身は人（文書担当）が書く。ここは様式の定義と、書かれた内容の検証だけ。純粋関数。
import { idsIn, isIso } from "./common.mjs";

export const ACTION_COLUMNS = [
  "action_id",
  "what",
  "finding_ids",
  "domain",
  "priority",
  "phase",
  "when",
  "owner",
  "due",
  "reverify_by",
  "status",
  "effect",
  "cost",
  "urgency",
  "feasibility",
  "review_date",
];

export const ACTION_VOCAB = {
  priority: ["high", "medium", "low"],
  status: ["open", "in_progress", "accepted", "done", "cancelled"],
  domain: [
    "plan",
    "perspective",
    "spec",
    "regression",
    "automation",
    "api",
    "performance",
    "inspection",
    "execution",
    "quality",
    "monitoring",
    "analysis",
    "evidence",
  ],
};

const DATE_COLUMNS = ["due", "reverify_by", "review_date"];
const REQUIRED = ["action_id", "what", "domain", "priority", "phase", "when", "owner", "due", "status"];
const dateOk = (v) => isIso(v) || v.startsWith("未定");

/** 1 行の問題（文字列の配列）。findingIds が空なら finding_ids の解決は検査しない。 */
function rowProblems(r, findingIds) {
  return [
    ...(/^ACT-\d{3}$/.test(r.action_id) ? [] : ["action_id が ACT-nnn の形でない"]),
    ...REQUIRED.filter((c) => !r[c]).map((c) => `${c} が空`),
    ...Object.entries(ACTION_VOCAB)
      .filter(([col, vocab]) => r[col] && !vocab.includes(r[col]))
      .map(([col]) => `${col} が語彙外（${r[col]}）`),
    ...DATE_COLUMNS.filter((c) => r[c] && !dateOk(r[c])).map(
      (c) => `${c} が日付（ISO 8601）でも「未定」でもない（${r[c]}）`,
    ),
    ...idsIn(r.finding_ids)
      .filter((id) => findingIds.size > 0 && !findingIds.has(id))
      .map((id) => `finding_ids の ${id} が findings.csv に無い`),
  ];
}

/** findingIds: FND-nnn の集合（findings.csv）。 */
export function checkActions(rows, findingIds, report) {
  const ids = rows.map((r) => r.action_id);
  for (const id of ids.filter((x, i) => ids.indexOf(x) !== i)) report.error(`${id}: action_id が重複`);
  for (const r of rows)
    for (const p of rowProblems(r, findingIds)) report.error(`${r.action_id || "(ID なし)"}: ${p}`);
}
