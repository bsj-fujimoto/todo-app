// findings.json の組み立て（純粋関数。読み込みと書き出しは triage.mjs が行う）。
import { missingScans } from "./collect.mjs";
import { assignIds, idMap } from "./finding-ids.mjs";
import { validateAccepted, validateTriage, matches } from "./ledger.mjs";
import { applyLedgers, countBy, gate, trend, withTrend } from "./triage.mjs";

const runSummary = (r) => ({
  scan: r.scan,
  check_kind: r.check_kind,
  tool: r.tool,
  status: r.status,
  skipped_reason: r.skipped_reason ?? null,
  commit_sha: r.target?.commit_sha ?? null,
  started_at: r.started_at,
  finding_count_sarif: r.finding_count_sarif ?? null,
  config_ref: r.config_ref,
  run_url: r.run_url ?? null,
});

const fixedFrom = (previous, t, ids) => {
  const gone = new Set(t.fixed);
  return (previous?.findings ?? [])
    .filter((f) => gone.has(f.fingerprint))
    .map((f) => ({
      ...f,
      finding_id: ids.get(f.fingerprint) ?? f.finding_id,
      status: "fixed",
      trend: "fixed",
    }));
};

const staleEntries = (entries, findings, label) =>
  entries
    .filter((e) => !findings.some((f) => matches(e, f)))
    .map(
      (e) =>
        `${label}: ${e.id ?? JSON.stringify(e.match ?? e.fingerprint)} はどの検出にも当たらない（解消したなら台帳から外す）`,
    );

export function buildDocument({ scans, ledgers, previous, expected, today, nowIso, run, findingIds = [] }) {
  const raw = scans.flatMap((s) => s.findings);
  const applied = applyLedgers(raw, ledgers);
  const t = trend(applied, previous);
  // finding_id は並び順ではなく fingerprint から決まる安定 ID（security/finding-ids.yaml）。台帳に無いものは仮 ID にして警告する
  const { findings, unregistered } = assignIds(withTrend(applied, t), findingIds);
  const runs = scans.map((s) => s.run);
  const missing = missingScans(expected, runs);
  const ledgerProblems = [...validateTriage(ledgers.triage), ...validateAccepted(ledgers.accepted, today)];
  const g = gate(findings);
  return {
    schema_version: 1,
    generated_at: nowIso,
    run_url: run.run_url,
    target: runs[0]?.target ?? { repository: null, branch: null, commit_sha: null },
    scans: runs.map(runSummary),
    missing_scans: missing,
    summary: {
      by_status: countBy(findings, "status"),
      by_severity: countBy(findings, "severity"),
      by_category: countBy(findings, "category"),
    },
    trend: t,
    gate: {
      ...g,
      result: g.result === "fail" || missing.length || ledgerProblems.length ? "fail" : "pass",
      ledger_problems: ledgerProblems,
      // 台帳（security/finding-ids.yaml）に無い検出。失敗にはしないが、assign-finding-ids.mjs で ID を振って commit する
      unregistered_finding_ids: unregistered,
    },
    stale_ledger_entries: [
      ...staleEntries(ledgers.triage, findings, "triage.yaml"),
      ...staleEntries(ledgers.accepted, findings, "accepted-risks.yaml"),
    ],
    findings,
    fixed: fixedFrom(previous, t, idMap(findingIds)),
  };
}
