// 成果物台帳（docs/evidence/artifacts.yaml）の項目を、文書のヘッダ表と git の履歴から組み立てる。純粋関数。
// 手書きとの二重管理を避けるため、台帳には書き込まず、ここで文書から読む。承認を捏造しない（承認の記録が無ければ approved_by は null）。
import { sha256, shortSha } from "./common.mjs";

export const RETENTION_POLICY = "Git 履歴は永続。CI artifact は 90 日。リリース添付は永続";
export const DEFAULT_OWNER = "プロダクトオーナー"; // .github/CODEOWNERS の既定の所有者（プロダクトオーナー兼メンテナ）

/** 管理対象のパス → 種別。対象外なら null。 */
const TYPE_RULES = [
  [/^docs\/\d{2}-[^/]+\.md$/, () => "document"],
  [/^docs\/adr\/[^/]+\.md$/, () => "adr"],
  [/^docs\/data\/([^/]+)\.csv$/, (m) => `table:${m[1]}`],
  [/^backend\/openapi\.yaml$/, () => "api_spec"],
  [/^spec\/[^/]+\.html$/, () => "ui_spec"],
  [/^perf\/slo\.yaml$/, () => "slo"],
  [/^(perf|monitoring)\/[^/]+\.(ya?ml|md)$/, (m) => `${m[1]}_config`],
  [/^security\/[^/]+\.(ya?ml|md|toml|env|tsv)$/, () => "security_policy"],
  [/^quality\/[^/]+\.(ya?ml|md|csv)$/, () => "quality_ledger"],
  [/^docs\/evidence\/manual-plan\.yaml$/, () => "evidence_ledger"],
  [/^docs\/evidence\/README\.md$/, () => "document"],
];

export function typeOf(path) {
  for (const [re, make] of TYPE_RULES) {
    const m = re.exec(path);
    if (m) return make(m);
  }
  return null;
}

const OWNER_RULES = [
  [/^docs\/data\//, "QA 担当"],
  [/^docs\/evidence\//, "QA 担当"],
  [/^quality\//, "QA 担当"],
  [/^backend\//, "バックエンド担当"],
  [/^security\//, "セキュリティ担当"],
];

/**
 * md のヘッダ表（`| 項目 | 内容 |` で始まる表）→ { 文書ID, 版, 状態, 作成, 承認, ... }。
 * ヘッダ表の行だけを読む。本文中の別の表（例: ADR の「承認 | 1 件 + code owner review」という規則の表）の行を、
 * 文書の承認者などと取り違えない。ヘッダ表が無い文書（ADR は箇条書き）は空を返す。
 */
export function parseDocHeader(md) {
  const out = {};
  const lines = md.split("\n");
  const start = lines.findIndex((line) => /^\|\s*項目\s*\|\s*内容\s*\|\s*$/.test(line));
  if (start === -1) return out;
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("|")) break; // 表の終わり
    const m = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/.exec(line);
    if (m && !/^[-:\s]+$/.test(m[1])) out[m[1]] = m[2];
  }
  return out;
}

const STATUS_WORDS = [
  [/^(draft|下書き)/i, "draft"],
  [/^(reviewed|レビュー済)/i, "reviewed"],
  [/^(approved|承認済|採用)/i, "approved"],
  [/^(obsolete|廃止)/i, "obsolete"],
];

export const statusFrom = (text) =>
  STATUS_WORDS.find(([re]) => re.test(String(text ?? "").trim()))?.[1] ?? null;
const roleOf = (text) =>
  String(text ?? "")
    .split(/[（(]/)[0]
    .trim() || null;

const mdTitle = (md) => /^#\s+(.+)$/m.exec(md)?.[1].trim() ?? null;
const yamlTitle = (text) => /^#\s*(.+)$/m.exec(text)?.[1].trim() ?? null;
const htmlTitle = (html) => /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? null;
const htmlVersion = (html) => /Version\s+(\d+(?:\.\d+)*)/.exec(html)?.[1] ?? null;
const openapiVersion = (text) => /^info:[\s\S]*?^\s+version:\s*(\S+)/m.exec(text)?.[1] ?? null;

/** ADR は表ではなく箇条書き（- 状態: 採用 / - 決定者: プロダクトオーナー）で書かれている。 */
function adrFields(text) {
  const line = (key) => new RegExp(`^- ${key}:\\s*(.+)$`, "m").exec(text)?.[1];
  return { status: statusFrom(line("状態")), decided: roleOf(line("決定者")) };
}

function describeMd(text, type) {
  const header = parseDocHeader(text);
  const adr = type === "adr" ? adrFields(text) : { status: null, decided: null };
  const status = statusFrom(header["状態"]) ?? adr.status;
  return {
    title: mdTitle(text),
    version: header["版"] ?? null,
    status,
    owner_role: roleOf(header["作成"]) ?? adr.decided,
    // 承認は「承認済みと書かれている文書の、承認者の役割」だけ。draft は承認前なので null
    approved_by: status === "approved" ? (roleOf(header["承認"]) ?? adr.decided) : null,
    doc_id: header["文書ID"] ?? null,
  };
}

/** 文書の中身から読めるもの。読めないものは null（呼び出し側が既定を入れる）。 */
export function describeContent(path, text, type) {
  if (path.endsWith(".md")) return describeMd(text, type);
  const base = {
    title: null,
    version: null,
    status: null,
    owner_role: null,
    approved_by: null,
    doc_id: null,
  };
  if (path.endsWith(".html")) return { ...base, title: htmlTitle(text), version: htmlVersion(text) };
  if (path.endsWith("openapi.yaml"))
    return { ...base, title: yamlTitle(text) ?? "todo-app API", version: openapiVersion(text) };
  return { ...base, title: yamlTitle(text) };
}

export const ownerFor = (path) => OWNER_RULES.find(([re]) => re.test(path))?.[1] ?? DEFAULT_OWNER;

/** git log の行（sha\tISO\tsubject）→ 履歴。人名は書かず、作成者は役割（maintainer）にする。 */
export function historyFrom(logLines) {
  return logLines
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .map(([sha, at, ...subject]) => ({
      at,
      by: "maintainer",
      change: subject.join("\t"),
      commit: shortSha(sha),
    }));
}

/** 台帳の 1 項目。info: describeContent の結果、git: { lastShort, history, updatedAt }。 */
export function artifactEntry({ id, path, buffer, info, git, authoritative }) {
  const type = typeOf(path);
  return {
    artifact_id: id,
    path,
    type,
    title: info.title ?? path,
    version: info.version ?? `git:${git.lastShort ?? "未コミット"}`,
    status: info.status ?? "reviewed",
    owner_role: info.owner_role ?? ownerFor(path),
    approved_by: info.approved_by,
    updated_at: git.updatedAt,
    authoritative,
    normalized_format: path.split(".").pop(),
    history: git.history,
    source_sha256: sha256(buffer),
    retention_policy: RETENTION_POLICY,
    immutable_store: true,
    ...(info.doc_id ? { doc_id: info.doc_id } : {}),
  };
}
