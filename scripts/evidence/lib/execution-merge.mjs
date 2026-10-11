// 既存の実施表と、今回の run の行をまとめる。同じ run の行は置き換える（冪等）。EXEC-0001 形式の ID は同じ行なら引き継ぐ。純粋関数。
const keyOf = (row) => `${row.run_ref}|${row.test_case_id}|${row.environment}`;
const numberOf = (id) => Number(/^EXEC-(\d+)$/.exec(id ?? "")?.[1] ?? 0);
export const formatExecutionId = (n) => `EXEC-${String(n).padStart(4, "0")}`;

/**
 * existing: 現在の executions.csv の行。built: 今回の run の行（execution_id なし）。
 * 別の版（commit_sha）の行が残るときは、prune が false なら失敗（版の混在）、true なら捨てる。
 */
export function mergeRows({ existing, built, runRef, prune, report }) {
  const sha = built[0]?.commit_sha;
  const others = existing.filter((r) => r.run_ref !== runRef);
  const foreign = others.filter((r) => r.commit_sha !== sha);
  if (foreign.length > 0 && !prune) {
    const shas = [...new Set(foreign.map((r) => r.commit_sha.slice(0, 7)))].join(", ");
    report.error(
      `別の版（${shas}）の実施行が ${foreign.length} 件残っている。--prune-other-versions で捨てるか、取り込む run を揃える`,
    );
  }
  const kept = prune ? others.filter((r) => r.commit_sha === sha) : others;
  const previous = new Map(
    existing.filter((r) => r.run_ref === runRef).map((r) => [keyOf(r), r.execution_id]),
  );
  return [...kept, ...built.map((r) => ({ ...r, execution_id: previous.get(keyOf(r)) ?? "" }))];
}

/** ID の無い行に、既存の最大値の次から連番を振る（並びは渡された順）。結果は ID 順。 */
export function assignIds(rows) {
  let next = Math.max(0, ...rows.map((r) => numberOf(r.execution_id))) + 1;
  const withIds = rows.map((r) => (r.execution_id ? r : { ...r, execution_id: formatExecutionId(next++) }));
  return withIds.sort((a, b) => numberOf(a.execution_id) - numberOf(b.execution_id));
}
