// 証拠索引の検査: 参照（ファイル・アンカー）が解決し、sha256 が一致する。解決しない参照は失敗。ファイル読込を伴う。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../../ci/lib/csv.mjs";
import { sha256 } from "./common.mjs";
import { EVIDENCE_COLUMNS } from "./evidence-registry.mjs";

const REQUIRED = [
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

/** アンカーが指すものがファイルの中にあるか。形式ごとに探す（JUnit: [TC-xxx]、JSON: Issue 番号・finding_id、CSV: 先頭列）。 */
export function anchorExists(file, text, anchor) {
  if (file.endsWith(".xml")) return text.includes(`[${anchor}]`);
  if (file.endsWith(".csv")) return parseCsv(text).some((r) => r[0] === anchor);
  if (file.endsWith(".json")) {
    const doc = JSON.parse(text);
    const issue = /^issue-(\d+)$/.exec(anchor);
    if (issue && doc.issues) return doc.issues.some((i) => i.number === Number(issue[1]));
    if (doc.findings) return doc.findings.some((f) => f.finding_id === anchor);
  }
  return text.includes(anchor);
}

/** 1 件の参照を検査する。戻り値: 問題の文字列の配列（空なら解決した）。外部 URL はオフラインでは確かめない。 */
export function checkRef(root, row) {
  const ref = row.ref ?? "";
  if (/^https?:\/\//.test(ref)) return [];
  const [path, anchor] = ref.replace(/^\.\//, "").split("#");
  const abs = join(root, path);
  if (!existsSync(abs)) return [`参照先のファイルが無い: ${path}`];
  const buffer = readFileSync(abs);
  const problems = [];
  if (row.sha256 && row.sha256 !== sha256(buffer))
    problems.push(`sha256 が一致しない（改変またはスナップショットの更新）: ${path}`);
  if (anchor && !anchorExists(path, buffer.toString("utf8"), decodeURIComponent(anchor))) {
    problems.push(`アンカーが解決しない: ${path}#${anchor}`);
  }
  return problems;
}

/** 索引全体の検査。 */
export function checkEvidenceIndex(root, rows, report) {
  const ids = new Set();
  for (const r of rows) {
    const where = r.evidence_id || "(ID なし)";
    if (ids.has(r.evidence_id)) report.error(`${where}: 証拠 ID が重複`);
    ids.add(r.evidence_id);
    for (const col of REQUIRED.filter((c) => !r[c] && !["sha256", "captured_at", "head_sha"].includes(c))) {
      report.error(`${where}: ${col} が空`);
    }
    for (const p of checkRef(root, r)) report.error(`${where}: ${p}`);
  }
}

export const evidenceColumnsOk = (header) => EVIDENCE_COLUMNS.every((c, i) => header[i] === c);
