// 検出の重複排除・台帳の適用・前回との差分・ゲート判定 → findings.json。
// 機械が決めること: 重複（同じ勧告 ID × 同じ部品）、前回との差分、期限切れ、ゲート。
// 機械が決めないこと: 真偽（tp/fp）・到達可能性・公開範囲・資産影響・補完統制・是正案。これらは台帳の記載をそのまま写す。
import { SEVERITIES } from "./findings.mjs";
import { acceptanceWithinLimit, isExpired, matches } from "./ledger.mjs";

const CONTEXT_FIELDS = [
  "reason",
  "reachability",
  "exposure",
  "asset_impact",
  "compensating_controls",
  "recommendation",
  "alternative",
  "owner",
  "due",
  "reverify_condition",
  "decided_by",
  "decided_at",
  "issue",
];
// 同じ勧告を複数のツールが出したとき、どれを正とするか（情報が多い順）。
const TOOL_PRIORITY = ["osv-scanner", "trivy", "npm-audit"];
const rank = (f) => {
  const i = TOOL_PRIORITY.indexOf(f.tool);
  return i === -1 ? TOOL_PRIORITY.length : i;
};

const pickContext = (entry) => Object.fromEntries(CONTEXT_FIELDS.map((k) => [k, entry[k] ?? null]));
const emptyContext = () => Object.fromEntries(CONTEXT_FIELDS.map((k) => [k, null]));

/** 同じ勧告 ID（CVE/GHSA の別名を含む）× 同じ部品の検出を 1 つにまとめ、残りを dup にする。 */
export function dedupe(findings) {
  const sorted = [...findings].sort((a, b) => rank(a) - rank(b));
  const kept = [];
  const dups = new Map();
  for (const f of sorted) {
    const same =
      f.advisories.length && f.component
        ? kept.find((k) => k.component === f.component && k.advisories.some((a) => f.advisories.includes(a)))
        : null;
    if (same) dups.set(f.fingerprint, same.fingerprint);
    else kept.push(f);
  }
  return findings.map((f) => (dups.has(f.fingerprint) ? { ...f, duplicate_of: dups.get(f.fingerprint) } : f));
}

function statusFor(f, { triage, accepted, today }) {
  const acc = accepted.find((e) => matches(e, f));
  if (acc) return acceptedStatus(f, acc, today);
  if (f.duplicate_of)
    return {
      status: "dup",
      context: { ...emptyContext(), reason: `${f.duplicate_of} と同じ勧告・同じ部品（機械判定）` },
    };
  const tri = triage.find((e) => matches(e, f));
  if (tri) return { status: tri.status, context: pickContext(tri), ledger: "triage.yaml" };
  return { status: "untriaged", context: emptyContext() };
}

function acceptedStatus(f, acc, today) {
  const context = { ...emptyContext(), ...pickContext(acc) };
  if (isExpired(acc, today))
    return {
      status: "untriaged",
      context,
      acceptance_problem: `受容 ${acc.id} は期限切れ（${acc.expires_at}）`,
    };
  if (!acceptanceWithinLimit(acc, f.severity)) {
    return {
      status: "untriaged",
      context,
      acceptance_problem: `受容 ${acc.id} は ${f.severity} の上限期間を超える（または受容できない重大度）`,
    };
  }
  return {
    status: "accepted",
    context,
    ledger: "accepted-risks.yaml",
    accepted_by: acc.id,
    expires_at: acc.expires_at,
  };
}

export function applyLedgers(findings, ledgers) {
  return dedupe(findings).map((f) => {
    const { status, context, ...extra } = statusFor(f, ledgers);
    return { ...f, status, ...context, ...extra };
  });
}

export function trend(current, previous) {
  if (!previous)
    return { previous_run_ref: null, new: current.map((f) => f.fingerprint), persistent: [], fixed: [] };
  const prev = new Set(previous.findings.map((f) => f.fingerprint));
  const now = new Set(current.map((f) => f.fingerprint));
  return {
    previous_run_ref: previous.run_url ?? previous.commit_sha ?? "previous",
    new: [...now].filter((fp) => !prev.has(fp)),
    persistent: [...now].filter((fp) => prev.has(fp)),
    fixed: [...prev].filter((fp) => !now.has(fp)),
  };
}

export function withTrend(findings, t) {
  const fresh = new Set(t.new);
  return findings.map((f) => ({ ...f, trend: fresh.has(f.fingerprint) ? "new" : "persistent" }));
}

const OPEN = new Set(["untriaged", "tp"]);

/** ゲート: critical/high で未解決（untriaged / tp）は失敗。受容できない重大度・期限切れ・上限超過もここで落ちる。 */
export function gate(findings) {
  const blocking = findings.filter((f) => ["critical", "high"].includes(f.severity) && OPEN.has(f.status));
  const warnings = findings.filter((f) => f.severity === "medium" && OPEN.has(f.status));
  const problems = findings
    .filter((f) => f.acceptance_problem)
    .map((f) => `${f.fingerprint}: ${f.acceptance_problem}`);
  return {
    blocking: blocking.map(brief),
    medium_needs_issue_or_acceptance: warnings.map(brief),
    acceptance_problems: problems,
    result: blocking.length ? "fail" : "pass",
  };
}

const brief = (f) => ({
  fingerprint: f.fingerprint,
  severity: f.severity,
  tool: f.tool,
  rule_id: f.rule_id,
  location: f.location,
  component: f.component,
  status: f.status,
  title: f.title,
});

export function countBy(findings, key) {
  const out = {};
  for (const f of findings) out[f[key]] = (out[f[key]] ?? 0) + 1;
  return out;
}

export function renderSummary(doc) {
  const sev = SEVERITIES.map((s) => `${s} ${doc.summary.by_severity[s] ?? 0}`).join(" / ");
  const st =
    Object.entries(doc.summary.by_status)
      .map(([k, v]) => `${k} ${v}`)
      .join(" / ") || "なし";
  const lines = [
    "### セキュリティ検査のトリアージ",
    "",
    `- 対象: \`${doc.target.repository}\` ${doc.target.branch} \`${doc.target.commit_sha}\``,
    `- 検出 ${doc.findings.length} 件（重複排除後）: ${sev}`,
    `- ステータス: ${st}`,
    `- 前回比: 新規 ${doc.trend.new.length} / 継続 ${doc.trend.persistent.length} / 解消 ${doc.trend.fixed.length}（前回: ${doc.trend.previous_run_ref ?? "なし"}）`,
    `- ゲート: **${doc.gate.result}**（critical/high の未解決 ${doc.gate.blocking.length} 件）`,
  ];
  for (const b of doc.gate.blocking)
    lines.push(
      `  - [${b.severity}] ${b.tool} ${b.rule_id} ${b.component ?? ""} ${b.location}（${b.status}）`,
    );
  if (doc.gate.medium_needs_issue_or_acceptance.length) {
    lines.push(
      `- medium の未解決 ${doc.gate.medium_needs_issue_or_acceptance.length} 件（Issue 化して accepted-risks.yaml で期限付き受容、または修正）`,
    );
  }
  for (const p of doc.gate.acceptance_problems) lines.push(`- 受容の問題: ${p}`);
  for (const m of doc.missing_scans) lines.push(`- 実行されなかった検査: ${m}`);
  return `${lines.join("\n")}\n`;
}
