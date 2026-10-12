// run の役割台帳（docs/evidence/run-roles.yaml）。どの run が「対象版（release.json の commit X）の試験結果」で、どれが「履歴」か。純粋関数。
//   role: target  … 対象版 X の run。実施表（kind=regression / performance）の根拠になる。
//   role: history … 対象版の結果ではない（別の commit の run・開発機の実験・初回の run・未コミットの変更を含む実行）。
//                   証跡としては残す（削除しない）が、実施表・証拠索引の根拠にしない。
// 役割は commit と実行の状態から決める（人が付け替えない）。実施表が history の run を参照していたら失敗にする（check-evidence）。

/** 履歴になる理由（複数ありうる）。run: { sha, dirty, env, supersededReason }。 */
function historyReasons(run, targetSha) {
  return [
    run.supersededReason,
    run.sha !== targetSha ? `対象版 ${targetSha.slice(0, 7)} と別の commit（${run.sha.slice(0, 7)}）` : null,
    run.dirty ? "作業ツリーに未コミットの変更を含む（実験・調整）" : null,
    run.env?.startsWith("local:") ? `開発機（${run.env}）での実行で、CI の環境と別` : null,
  ].filter(Boolean);
}

/** 1 つの run の役割と理由。環境が開発機でも、対象版の commit で変更なしなら参考の位置づけ（役割は commit と変更の有無で決める）。 */
export function classifyRun(run, targetSha) {
  const reasons = historyReasons(run, targetSha);
  const decisive = reasons.filter((r) => !r.startsWith("開発機"));
  if (decisive.length === 0) return { role: "target", reason: `対象版 ${targetSha.slice(0, 7)} の実行` };
  return { role: "history", reason: `${reasons.join("。")}。対象版の試験結果ではない` };
}

const asRun = (entry) => ({
  sha: entry.commit_sha,
  dirty: Boolean(entry.dirty),
  env: entry.env_class ?? null,
  supersededReason: entry.superseded_reason ?? null,
});

const supersededText = (s) =>
  s.superseded_by
    ? `実施表の基準を run ${s.superseded_by.run_id}（対象 ${String(s.superseded_by.head_sha).slice(0, 7)}）へ取り替えた。この run は履歴`
    : null;

const byRunThenKind = (a, b) => a.run_ref.localeCompare(b.run_ref) || a.kind.localeCompare(b.kind);

/**
 * sources: 取り込んだ run（docs/evidence の SOURCE.json）→ { run_id, kind, workflow, head_sha, path, superseded_by }。
 * perfRuns: 開発機などで実行した性能試験（perf/results/*\/run.json）→ { run_id, commit_sha, dirty, env_class, path }。
 * 戻り値: 台帳の項目（run_ref・kind の昇順）。同じ run（Release run）の ci と security の取り込みは別の項目になる。
 */
export function buildRunRoles({ sources, perfRuns, targetSha }) {
  const imported = sources.map((s) => ({
    run_ref: `gh-run-${s.run_id}`,
    kind: s.kind,
    workflow: s.workflow ?? null,
    commit_sha: s.head_sha,
    evidence: s.path,
    ...classifyRun(asRun({ commit_sha: s.head_sha, superseded_reason: supersededText(s) }), targetSha),
  }));
  const local = perfRuns.map((r) => ({
    run_ref: `perf-${r.run_id}`,
    kind: "perf",
    workflow: null,
    commit_sha: r.commit_sha,
    evidence: r.path,
    environment: r.env_class,
    ...classifyRun(asRun(r), targetSha),
  }));
  return [...imported, ...local].sort(byRunThenKind);
}

/** 実施表の run_ref → 台帳の役割。target の項目が 1 つも無い run（history だけ・台帳に無い）を参照している行を指摘する。 */
export function checkExecutionRuns(executionRows, roles, report) {
  const refs = [...new Set(executionRows.map((r) => r.run_ref).filter(Boolean))];
  for (const ref of refs) {
    const entries = roles.filter((r) => r.run_ref === ref);
    if (entries.length === 0)
      report.error(`実施表の run_ref ${ref} が run-roles.yaml に無い（取り込んだ run か確かめる）`);
    else if (!entries.some((r) => r.role === "target"))
      report.error(`実施表が履歴の run ${ref} を参照している（${entries[0].reason}）`);
  }
}
