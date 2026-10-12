// 人が書く台帳（security/triage.yaml・security/accepted-risks.yaml）の読込・検証・突合。
// 機械は「どの検出がどの記載に当たるか」を決めるだけで、文脈（到達可能性など）や是正案は台帳の文面をそのまま取り込む。
import { globToRegExp, isFile, readText } from "../../ci/lib/repo-fs.mjs";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";

export const TRIAGE_STATES = ["tp", "fp", "na", "dup"];
// 検出ごとの台帳に必須の項目。recommendation は修正方法、修正しないなら「修正しない理由と代替統制」。due は期限（na・fp は再確認の期日）
export const REQUIRED_FIELDS = [
  "reason",
  "recommendation",
  "alternative",
  "owner",
  "due",
  "reverify_condition",
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
export const MAX_ACCEPT_DAYS = { critical: 0, high: 30, medium: 90, low: 180, info: 365 };

export function loadEntries(root, path) {
  if (!isFile(root, path)) return [];
  return (parseYaml(readText(root, path)) ?? {}).entries ?? [];
}

const globOk = (pattern, value) => globToRegExp(String(pattern)).test(String(value ?? ""));
const MATCH_FIELDS = [
  ["tool", (p, f) => p === f.tool],
  ["scan", (p, f) => p === f.scan],
  ["rule_id", (p, f) => globOk(p, f.rule_id)],
  ["component", (p, f) => globOk(p, f.component)],
  ["location", (p, f) => globOk(p, f.location.replace(/:\d+(:\d+)?$/, ""))],
  ["category", (p, f) => p === f.category],
];

/** 台帳の 1 エントリが検出に当たるか。fingerprint 指定は完全一致、match は指定した項目すべてに一致。 */
export function matches(entry, finding) {
  if (entry.fingerprint) return entry.fingerprint === finding.fingerprint;
  const m = entry.match ?? {};
  const keys = MATCH_FIELDS.filter(([k]) => m[k] !== undefined);
  return keys.length > 0 && keys.every(([k, test]) => test(m[k], finding));
}

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const missing = (e, keys) => keys.filter((k) => e[k] === undefined || e[k] === null || e[k] === "");

function triageProblems(e, label) {
  const out = [];
  if (!TRIAGE_STATES.includes(e.status))
    out.push(`${label}: status は ${TRIAGE_STATES.join("/")} のいずれか（accepted は accepted-risks.yaml）`);
  if (!e.fingerprint && !e.match) out.push(`${label}: match か fingerprint が無い`);
  // すべての状態（tp・fp・na・dup）に、理由・修正方法（または修正しない理由と代替統制）・代替案・owner・期限・再検査条件を求める
  const miss = missing(e, REQUIRED_FIELDS);
  if (miss.length) out.push(`${label}: ${miss.join(",")} が無い`);
  return out;
}

export function validateTriage(entries) {
  return entries.flatMap((e, i) => triageProblems(e, `triage.yaml[${i}]`));
}

function acceptedProblems(e, today) {
  const label = e.id ?? "(id なし)";
  const miss = missing(e, [
    "id",
    "reason",
    "recommendation",
    "alternative",
    "owner",
    "accepted_at",
    "expires_at",
    "reverify_condition",
  ]);
  if (miss.length) return [`${label}: ${miss.join(",")} が無い`];
  if (!e.fingerprint && !e.match) return [`${label}: match か fingerprint が無い`];
  if (![e.accepted_at, e.expires_at].every((d) => DATE_RE.test(String(d))))
    return [`${label}: 日付の書式が YYYY-MM-DD でない`];
  return e.expires_at < today
    ? [`${label}: 受容の期限切れ（${e.expires_at}）。直すか、理由付きで再受容する`]
    : [];
}

export function validateAccepted(entries, today) {
  return entries.flatMap((e) => acceptedProblems(e, today));
}

/** 受容の期間が重大度ごとの上限（critical は受容不可 / high 30 日 / medium 90 日）を超えていないか。 */
export function acceptanceWithinLimit(entry, severity) {
  const limit = MAX_ACCEPT_DAYS[severity] ?? 0;
  return limit > 0 && days(entry.accepted_at, entry.expires_at) <= limit;
}

export const isExpired = (entry, today) => String(entry.expires_at) < today;
