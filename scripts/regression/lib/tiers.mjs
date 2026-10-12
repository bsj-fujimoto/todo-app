// 各ケースが実行される層（tiers）を、ワークフローの実態（トリガー）から導く（純粋関数）。
//   pr      pull_request で動く ci.yml。変更影響で選んだケースと smoke だけ（impact-map に載っている自動化ケースが対象）
//   main    main への push で動く ci.yml。全件
//   daily   毎日の schedule（nightly.yml の毎日の cron）。全件・全ブラウザ
//   weekly  週 1 回の schedule（nightly.yml の曜日指定の cron）。全件を 3 回
//   release タグ v*.*.* で動く release.yml（ci.yml を呼ぶ）。全件 + compose + セキュリティ
// 選択実行（pr）の対象でも、全件の層（main・daily・weekly・release）では全ケースが動く。手動ケースはワークフローでは動かない（manual）。
export const TIER_ORDER = ["pr", "main", "daily", "weekly", "release"];

const has = (text, re) => re.test(text ?? "");

/** workflows: { "ci.yml": 本文, "nightly.yml": 本文, "release.yml": 本文 }。存在する層だけを返す（順序は TIER_ORDER）。 */
export function workflowTiers(workflows) {
  const ci = workflows["ci.yml"];
  const nightly = workflows["nightly.yml"];
  const crons = [...(nightly ?? "").matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1].trim().split(/\s+/));
  const found = new Set([
    has(ci, /^\s{2}pull_request:/m) && "pr",
    has(ci, /^\s{2}push:\s*\n\s+branches:\s*\[[^\]]*main/m) && "main",
    crons.some((c) => c[4] === "*") && "daily",
    crons.some((c) => c[4] !== "*") && "weekly",
    has(workflows["release.yml"], /tags:\s*\["v\*\.\*\.\*"\]/) && "release",
  ]);
  return TIER_ORDER.filter((t) => found.has(t));
}

/** 1 ケースの tiers。automated: 自動化ケースか。selectable: 変更影響の選択（impact-map・smoke）の対象か。 */
export function tiersOf({ automated, selectable }, available) {
  if (!automated) return ["manual"];
  return available.filter((t) => t !== "pr" || selectable);
}
