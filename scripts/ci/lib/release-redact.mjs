// リリース証跡（release-evidence/）の墨消しと manifest。墨消しの規則は証跡の取り込みと同じもの（scripts/evidence/lib/redact*.mjs）を共有する（コピーを作らない）。
// zip に入れる前に、人の氏名・メールアドレス・アカウント名・秘密情報らしい値を決定的に [REDACTED:…] へ置き換え、
// manifest.json に「墨消し済み」「元の sha256・墨消し後の sha256・件数」を残す。manifest の files[].sha256 は墨消し後のファイルのもの。
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { redactFiles } from "../../evidence/lib/redact-files.mjs";
import { REDACTION_REASON } from "../../evidence/lib/redact.mjs";
import { sha256Of } from "./artifacts.mjs";

export const MANIFEST = "manifest.json";

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );

/** dir 以下のファイルの相対パス（`/` 区切り、整列済み）。manifest.json は含めない。 */
export const releaseFiles = (dir) =>
  walk(dir)
    .map((p) => relative(dir, p).split(sep).join("/"))
    .filter((p) => p !== MANIFEST)
    .sort();

/** 本文を墨消しして書き戻す。戻り値: 墨消しした記録（path・規則ごとの件数・件数・original_sha256・redacted_sha256）。 */
export function redactRelease(dir, owners) {
  return redactFiles(dir, releaseFiles(dir), owners).map(
    ({ path, rules, count, original_sha256, redacted_sha256 }) => ({
      path,
      rules,
      count,
      original_sha256,
      redacted_sha256,
    }),
  );
}

/** manifest.json の内容。files は墨消し後のファイルの sha256。manifest 自身は含めない。 */
export function buildManifest({ dir, version, sha, records }) {
  const files = releaseFiles(dir).map((path) => {
    const buf = readFileSync(join(dir, path));
    return { path, bytes: buf.length, sha256: sha256Of(buf) };
  });
  return {
    schema_version: 1,
    version,
    commit_sha: sha,
    redacted: true,
    redaction: {
      reason: REDACTION_REASON,
      files_changed: records.length,
      replacements: records.reduce((n, r) => n + r.count, 0),
      note: "files[].sha256 は墨消し後のファイル。元の値は GitHub Actions の artifact（90 日）にだけある。redactions[].original_sha256 で対応が追える",
    },
    redactions: records,
    files,
  };
}
