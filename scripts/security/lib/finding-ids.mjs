// 検出の安定 ID。fingerprint（ツール + ルール + 場所 + 部品）→ FND-nnn の対応を台帳 security/finding-ids.yaml に固定する。
// 同じ fingerprint は、検出が増減しても同じ番号を保つ。番号は一度振ったら振り直さない・再利用しない（解消した検出の番号も残る）。
// 台帳に無い fingerprint は、CI では仮の ID（FND-NEW-<fingerprint の先頭 6 桁>）を付けて警告する。
// 台帳への追記は assign-finding-ids.mjs（人が実行して commit する。CI から main へ直接 commit しない）。
import { isFile, readText } from "../../ci/lib/repo-fs.mjs";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";

export const FND_RE = /^FND-(\d{3,})$/;
export const LEDGER_PATH = "security/finding-ids.yaml";

export function loadFindingIds(root) {
  if (!isFile(root, LEDGER_PATH)) return [];
  return (parseYaml(readText(root, LEDGER_PATH)) ?? {}).ids ?? [];
}

export const idMap = (entries) => new Map(entries.map((e) => [String(e.fingerprint), e.id]));

export const provisionalId = (fingerprint) => `FND-NEW-${String(fingerprint).slice(0, 6)}`;

/** 検出に安定 ID（finding_id）を付ける。台帳に無いものは仮 ID にして、その fingerprint を unregistered に返す。 */
export function assignIds(findings, entries) {
  const ids = idMap(entries);
  const unregistered = [];
  const out = findings.map((f) => {
    const id = ids.get(f.fingerprint);
    if (!id) unregistered.push(f.fingerprint);
    return { ...f, finding_id: id ?? provisionalId(f.fingerprint) };
  });
  return { findings: out, unregistered: [...new Set(unregistered)] };
}

const numberOf = (id) => Number(FND_RE.exec(id)?.[1] ?? 0);

/** 新しい fingerprint に、いまの最大番号の次から順に振る（既存は変えない）。 */
export function allocate(entries, newFindings, firstSeen) {
  let next = Math.max(0, ...entries.map((e) => numberOf(e.id))) + 1;
  const have = new Set(entries.map((e) => String(e.fingerprint)));
  const added = [];
  for (const f of newFindings) {
    if (have.has(f.fingerprint)) continue;
    have.add(f.fingerprint);
    added.push({
      id: `FND-${String(next++).padStart(3, "0")}`,
      fingerprint: f.fingerprint,
      first_seen: firstSeen,
      tool: f.tool,
      rule_id: f.rule_id,
      location: f.location,
    });
  }
  return added;
}

export function validateFindingIds(entries) {
  const problems = [];
  const seenId = new Set();
  const seenFp = new Set();
  for (const e of entries) {
    if (!FND_RE.test(String(e.id))) problems.push(`finding-ids.yaml: ${e.id} は FND-nnn の形ではない`);
    if (!e.fingerprint) problems.push(`finding-ids.yaml: ${e.id} に fingerprint が無い`);
    if (seenId.has(e.id)) problems.push(`finding-ids.yaml: ID ${e.id} が重複している`);
    if (seenFp.has(String(e.fingerprint)))
      problems.push(`finding-ids.yaml: fingerprint ${e.fingerprint} が重複している`);
    seenId.add(e.id);
    seenFp.add(String(e.fingerprint));
  }
  return problems;
}

export function renderLedger(entries) {
  const head = [
    "# 検出の安定 ID の台帳。fingerprint（ツール + ルール + 場所 + 部品）→ FND-nnn。triage.mjs が findings.json の finding_id にこの ID を使う。",
    "# 番号は一度振ったら振り直さない・再利用しない（検出が解消しても残す）。追記は scripts/security/assign-finding-ids.mjs（人が実行して commit する）。",
    "# docs/data/findings.csv の finding_id（FND-nnn）と同じ。CI は台帳に無い検出を仮 ID（FND-NEW-xxxxxx）にして警告する。",
    "version: 1",
    "ids:",
  ];
  const body = entries.map((e) =>
    [
      `  - id: ${e.id}`,
      `    fingerprint: "${e.fingerprint}"`,
      `    first_seen: ${e.first_seen}`,
      `    tool: ${e.tool}`,
      `    rule_id: "${e.rule_id}"`,
      `    location: "${String(e.location).replaceAll('"', "'")}"`,
    ].join("\n"),
  );
  return `${[...head, ...body].join("\n")}\n`;
}
