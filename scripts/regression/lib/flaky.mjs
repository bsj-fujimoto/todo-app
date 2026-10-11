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

function candidate(t, sha) {
  const label = t.tc_ids.join(",") || t.name;
  const body = [
    `同一 SHA（${sha}）・同一テストで pass と fail が混在した。`,
    "",
    `- テスト: \`${t.name}\`（層 ${t.layer}）`,
    `- 実行 ${t.runs} 回 / 失敗 ${t.failures} 回（失敗率 ${(t.rate * 100).toFixed(1)}%）`,
    "- 対応: quality/README.md の運用ルールに従う（retry で隠さない。隔離する場合は quality/flaky-ledger.yaml に原因・owner・期限を書く）。",
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
