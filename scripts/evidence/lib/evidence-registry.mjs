// 証拠索引（docs/data/evidence-index.csv）の採番。主張（claim）と参照先（ref）の組で EV-xxxx を安定して割り当てる
// （同じ組なら再生成しても同じ ID。既存の索引を読んで引き継ぐ）。純粋関数。
export const EVIDENCE_COLUMNS = [
  "evidence_id",
  "claim",
  "ref",
  "domain",
  "criterion_id",
  "type",
  "sha256",
  "captured_at",
  "head_sha",
];

const keyOf = (row) => `${row.ref}\n${row.claim}`;
const numberOf = (id) => Number(/^EV-(\d+)$/.exec(id)?.[1] ?? 0);
export const formatEvidenceId = (n) => `EV-${String(n).padStart(4, "0")}`;

/** existingRows: 既存の索引の行（無ければ空）。 */
export function createRegistry(existingRows = []) {
  const byKey = new Map(existingRows.map((r) => [keyOf(r), { ...r }]));
  let next = Math.max(0, ...existingRows.map((r) => numberOf(r.evidence_id))) + 1;
  return {
    /** entry: { claim, ref, domain, criterion_id, type, sha256, captured_at, head_sha }。同じ組は ID を保ち、中身は更新する。 */
    allocate(entry) {
      const found = byKey.get(keyOf(entry));
      const evidence_id = found?.evidence_id ?? formatEvidenceId(next++);
      byKey.set(keyOf(entry), { ...entry, evidence_id });
      return evidence_id;
    },
    get: (id) => [...byKey.values()].find((r) => r.evidence_id === id),
    has: (id) => [...byKey.values()].some((r) => r.evidence_id === id),
    rows: () => [...byKey.values()].sort((a, b) => numberOf(a.evidence_id) - numberOf(b.evidence_id)),
    /** keep に含まれる ID の行だけを残す（実施表から参照されなくなった旧 run の証拠を落とす）。 */
    prune(keep) {
      for (const [key, row] of byKey) if (!keep(row)) byKey.delete(key);
    },
  };
}
