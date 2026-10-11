// セキュリティ検査の finding_id（security.yml の triage は F-001 形式）と、証跡台帳の FND-001 形式の対応。純粋関数。
// 注意: triage の finding_id は検出の並び順で振られる（検出が増減すると番号が変わる）。安定した識別は fingerprint。

/** F-007 / FND-007 → 7（形式が違えば null）。 */
export const findingNumber = (id) => {
  const m = /^(?:FND|F)-(\d+)$/.exec(String(id));
  return m ? m[1].padStart(3, "0") : null;
};

/** 台帳の ID（FND-007）。 */
export const toFndId = (id) => {
  const n = findingNumber(id);
  return n ? `FND-${n}` : null;
};

/** findings.json（triage の出力）→ FND ID の集合と、FND ID → 検出の対応。 */
export function indexFindings(doc) {
  const byId = new Map();
  for (const f of doc?.findings ?? []) {
    const id = toFndId(f.finding_id);
    if (id) byId.set(id, f);
  }
  return byId;
}
