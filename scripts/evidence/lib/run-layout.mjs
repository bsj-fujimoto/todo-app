// `gh run download` で得た artifact ディレクトリ → docs/evidence/runs/<run-id>/ の構成（小さな実行成果物だけ）への対応づけ。
// 巨大な trace / video / HTML レポートは持ち込まない（失敗時の参照は SOURCE.json の artifacts に名前だけ残す）。
//   runs/<id>/ci-summary.json  regression-selection.json  docs-check-report.json  coverage-<backend|frontend>.json
//   runs/<id>/junit/<component>-junit.xml
//   runs/<id>/observations/<e2e|backend|frontend>/<TC-ID>[.<project>].json
//   runs/<id>/SOURCE.json（取得時刻・取得元 run の URL・対象 SHA・版）
import { toPosix } from "./common.mjs";

/** [正規表現, 変換先]。最初に一致した規則を使う。$1 $2 は正規表現のグループ。 */
const RULES = [
  [/^ci-summary\/ci-summary\.json$/, "ci-summary.json"],
  [/^regression-selection\/regression-selection\.json$/, "regression-selection.json"],
  [/^docs-check-reports\/docs-check-report\.json$/, "docs-check-report.json"],
  [/^e2e-evidence-compose\/test-results\/junit\.xml$/, "junit/compose-junit.xml"],
  [/^e2e-evidence-([^/]+)\/test-results\/junit\.xml$/, "junit/e2e-$1-junit.xml"],
  [/^e2e-evidence-[^/]+\/test-results\/observations\/([^/]+\.json)$/, "observations/e2e/$1"],
  [/^junit-coverage-unit-api\/backend\/test-results\/all\.xml$/, "junit/backend-junit.xml"],
  [/^junit-coverage-unit-api\/frontend\/test-results\/junit\.xml$/, "junit/frontend-junit.xml"],
  [
    /^junit-coverage-unit-api\/(backend|frontend)\/test-results\/observations\/([^/]+\.json)$/,
    "observations/$1/$2",
  ],
  [/^junit-coverage-unit-api\/(backend|frontend)\/test-results\/coverage-summary\.json$/, "coverage-$1.json"],
  [/^contract-report\/backend\/test-results\/contract\.xml$/, "junit/contract-junit.xml"],
];

function destination(rel) {
  for (const [re, to] of RULES) {
    const m = re.exec(rel);
    if (m) return to.replace(/\$(\d)/g, (_, n) => m[Number(n)]);
  }
  return null;
}

/** 相対パスの一覧 → コピー計画 [{ from, to }]（取り込み対象だけ。同じ行き先が重なったら失敗）。 */
export function planRunFiles(relPaths) {
  const plan = [];
  const seen = new Map();
  for (const from of relPaths.map(toPosix).sort()) {
    const to = destination(from);
    if (!to) continue;
    if (seen.has(to)) throw new Error(`行き先が重なる: ${seen.get(to)} と ${from} → ${to}`);
    seen.set(to, from);
    plan.push({ from, to });
  }
  return plan;
}

/** ダウンロードした artifact の名前（最上位のディレクトリ名）。SOURCE.json の artifacts に残す。 */
export const artifactNames = (relPaths) => [...new Set(relPaths.map((p) => toPosix(p).split("/")[0]))].sort();

/** ci-summary.json から SOURCE.json を組む。時刻・取得者は呼び出し側が渡す。 */
export function buildRunSource({ summary, nowIso, names, version, repository }) {
  const repo = summary.repository ?? repository;
  return {
    schema_version: 1,
    kind: "ci",
    captured_at: nowIso,
    source_url: `https://github.com/${repo}/actions/runs/${summary.run_id}`,
    head_sha: summary.commit_sha,
    version,
    repository: repo,
    run_id: String(summary.run_id),
    run_attempt: String(summary.run_attempt ?? "1"),
    workflow: summary.workflow ?? null,
    event: summary.event ?? null,
    ref: summary.ref ?? null,
    run_started_at: summary.started_at ?? null,
    artifacts: names,
    collected_by: "scripts/evidence/fetch-run.mjs",
  };
}

/** 版の既定: タグ（v1.2.3）の run ならその版、そうでなければ未リリース。 */
export const versionOf = (ref) =>
  /^v\d+\.\d+\.\d+/.test(String(ref ?? "")) ? String(ref).replace(/^v/, "") : "pre-1.0.0";
