// 不安定テスト（flaky）の検出と、隔離台帳（quality/flaky-ledger.yaml）との整合。
// flaky の定義: 同一 SHA・同一テストで pass と fail が混在すること（repeat-each / 再実行 / 複数 run の合算）。
import { layerOf, tcIdsOf } from "../../ci/lib/junit.mjs";
import { isFile, readText } from "../../ci/lib/repo-fs.mjs";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_QUARANTINE_DAYS = 30;
const REQUIRED = ["test_id", "rate", "cause", "owner", "since", "expires_at"];
const DAY = 86_400_000;

const keyOf = (tc, layer) => `${layer}|${tc.classname}|${tc.name}`;
const defaultLayer = (tc) => (/e2e/.test(tc.source) ? "e2e" : "unit");

/** observations: JUnit のテストケース配列（複数 run・複数 repeat を合算したもの）。 */
export function analyze(cases) {
  const tests = new Map();
  for (const tc of cases.filter((c) => c.status !== "skipped")) {
    const layer = layerOf(tc, defaultLayer(tc));
    const t = tests.get(keyOf(tc, layer)) ?? {
      key: keyOf(tc, layer),
      layer,
      name: tc.name,
      tc_ids: tcIdsOf(tc.name),
      runs: 0,
      failures: 0,
    };
    t.runs += 1;
    t.failures += tc.status === "failed" ? 1 : 0;
    tests.set(t.key, t);
  }
  return [...tests.values()].map((t) => ({ ...t, rate: t.runs ? t.failures / t.runs : 0 }));
}

export const isFlaky = (t) => t.failures > 0 && t.failures < t.runs;
export const isConsistentFailure = (t) => t.runs > 0 && t.failures === t.runs;

export function loadLedger(root) {
  if (!isFile(root, "quality/flaky-ledger.yaml")) return [];
  return (parseYaml(readText(root, "quality/flaky-ledger.yaml")) ?? {}).entries ?? [];
}

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

const hasRetry = (e) => "retries" in e || "retry" in e;
const isDate = (v) => DATE_RE.test(String(v));

function entryProblems(e, today) {
  const id = e.test_id ?? "(test_id なし)";
  const missing = REQUIRED.filter((k) => e[k] === undefined || e[k] === null || e[k] === "");
  if (missing.length) return [`${id}: ${missing.join(",")} が無い`];
  if (!isDate(e.since) || !isDate(e.expires_at)) return [`${id}: since / expires_at が日付でない`];
  const span = days(e.since, e.expires_at);
  return [
    String(e.expires_at) < today &&
      `${id}: 隔離の期限切れ（${e.expires_at}）。直すか、理由付きで期限を更新する`,
    span > MAX_QUARANTINE_DAYS && `${id}: 隔離は ${MAX_QUARANTINE_DAYS} 日まで（since から ${span} 日）`,
    hasRetry(e) && `${id}: retry で隠さない（retries の指定は不可）`,
  ].filter(Boolean);
}

export const validateLedger = (entries, today) => entries.flatMap((e) => entryProblems(e, today));

const inLedger = (t, entries) =>
  entries.some((e) => t.tc_ids.includes(e.test_id) || t.name.includes(String(e.test_id)));

const FEATURE = { e2e: "ui", api: "api", unit: "validation", compose: "infra" };

const bodyTail = (t, tc, fact) => [
  "## 再現手順",
  "",
  `1. nightly の全件回帰（週次は --repeat-each=3 / unit・api は 3 周）で、\`${t.name}\`（層 ${t.layer}）を同じ SHA で繰り返し実行する。`,
  "2. 実行のたびに pass と fail が混在する。",
  "",
  "## 期待結果",
  "",
  `同じコード・同じデータで、${tc ?? "このテスト"} は毎回同じ結果になる（retry で隠さず、安定して通る）。`,
  "",
  "## 実際の結果",
  "",
  fact,
  "",
  "## 影響",
  "",
  "main / PR の CI がアプリの不具合ではなく不安定さで赤になりうる。retry では隠さない（quality/README.md の運用ルール）。",
  "",
  "## 関連ケース / 証拠",
  "",
  `- ケース: ${tc ?? "（TC-ID なし）"}`,
  "- 証拠: nightly の flaky-report.json（artifact nightly-report-*）",
  "",
  "## 原因分類（判明後に記入）",
  "",
  "- 根本原因: 未判明（調査中）",
  "- 原因分類: test",
  "- 検出可能だった工程: test",
  "- 修正: 未修正。直せないときは quality/flaky-ledger.yaml に原因・owner・期限（30 日以内）を書く。",
];

// 不具合 Issue の様式（.github/ISSUE_TEMPLATE/defect.md）に合わせる。証跡（docs/data/defects.csv）の生成が、必須の項目の欠落で失敗しないように。
// 原因は起票時点では推定。判明したら Issue 本文の「原因分類」を人が直す。
function candidate(t, sha) {
  const label = t.tc_ids.join(",") || t.name;
  const tc = t.tc_ids[0];
  const rate = `${(t.rate * 100).toFixed(1)}%`;
  const fact = `同一 SHA（${sha}）・同一テストで pass と fail が混在した（実行 ${t.runs} 回 / 失敗 ${t.failures} 回、失敗率 ${rate}）。`;
  const body = [
    "## 識別",
    "",
    `- 検出工程: ${t.layer}（${fact}）`,
    "- 混入工程: test（推定。テストの待機・データ共有・環境依存のいずれか。原因の確定は調査で行う）",
    "- 重大度: minor",
    `- 機能: ${FEATURE[t.layer] ?? "infra"}`,
    "- 品質特性: reliability",
    `- 対象版: ${sha}`,
    `- 上流文書: ${tc ? `docs/data/cases.csv#${tc}` : "docs/data/cases.csv"}`,
    "",
    ...bodyTail(t, tc, fact),
  ].join("\n");
  return { fingerprint: t.key, title: `[flaky] ${label}`, labels: ["flaky"], body };
}

export function buildReport({ tests, ledger, today, sha, nowIso }) {
  const flaky = tests.filter(isFlaky).map((t) => ({ ...t, in_ledger: inLedger(t, ledger) }));
  const problems = validateLedger(ledger, today);
  return {
    schema_version: 1,
    commit_sha: sha,
    generated_at: nowIso,
    tests_observed: tests.length,
    flaky,
    consistent_failures: tests
      .filter(isConsistentFailure)
      .map((t) => ({ key: t.key, tc_ids: t.tc_ids, runs: t.runs })),
    ledger: { entries: ledger.length, problems },
    issue_candidates: flaky.filter((t) => !t.in_ledger).map((t) => candidate(t, sha)),
    result: flaky.length || problems.length ? "fail" : "pass",
  };
}
