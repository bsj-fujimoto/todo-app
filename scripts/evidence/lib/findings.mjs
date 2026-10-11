// セキュリティ検査の finding_id（security.yml の triage は F-001 形式）と、証跡台帳の FND-001 形式の対応。純粋関数。
// triage の finding_id は、fingerprint から決まる安定 ID（FND-nnn。台帳 security/finding-ids.yaml）。旧形式（F-001、検出の並び順）も写せる。

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

/**
 * 検出の台帳の ID（FND-nnn）。findings.json の finding_id が FND-nnn / F-nnn ならそれを写し、
 * triage が仮 ID（FND-NEW-xxxxxx）を付けた検出は、台帳 security/finding-ids.yaml の fingerprint から引く（取り込んだ findings.json は書き換えない）。
 * ledger: Map(fingerprint → FND-nnn)。引けなければ null。
 */
export const resolveFndId = (finding, ledger = new Map()) =>
  toFndId(finding.finding_id) ?? ledger.get(finding.fingerprint) ?? null;

/** findings.json（triage の出力）→ FND ID の集合と、FND ID → 検出の対応。 */
export function indexFindings(doc) {
  const byId = new Map();
  for (const f of doc?.findings ?? []) {
    const id = toFndId(f.finding_id);
    if (id) byId.set(id, f);
  }
  return byId;
}
