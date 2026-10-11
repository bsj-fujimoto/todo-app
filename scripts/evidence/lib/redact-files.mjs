// 取り込んだファイルの墨消し（ファイル入出力）。墨消しした記録（元ファイルと墨消し後の sha256・規則ごとの件数）を返し、SOURCE.json に残す。
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./common.mjs";
import { REDACTION_REASON, redactText } from "./redact.mjs";

const TEXT_EXT = /\.(json|sarif|jsonl|md|xml|txt|ya?ml|csv|tsv|html|log)$/;

/** relPaths（destDir からの相対）の本文を墨消しして書き戻す。戻り値: 墨消しした記録の配列（変更の無いファイルは含めない）。 */
export function redactFiles(destDir, relPaths, owners = []) {
  const records = [];
  for (const rel of relPaths.filter((p) => TEXT_EXT.test(p)).sort()) {
    const file = join(destDir, rel);
    const buffer = readFileSync(file);
    const result = redactText(buffer.toString("utf8"), rel, owners);
    if (!result.changed) continue;
    writeFileSync(file, result.text);
    records.push({
      path: rel,
      reason: REDACTION_REASON,
      rules: result.counts,
      count: result.counts.reduce((n, c) => n + c.count, 0),
      original_sha256: sha256(buffer),
      redacted_sha256: sha256(Buffer.from(result.text, "utf8")),
    });
  }
  return records;
}

/** SOURCE.json に書く内容。墨消しが無ければ空の配列。 */
export const redactionSection = (records) => ({
  redactions: records,
  redaction_note: records.length
    ? "取り込み時に墨消しした。manifest・証拠索引の sha256 は墨消し後のファイル。元の取得物は GitHub Actions の artifact（90 日）にだけある（original_sha256 で対応が追える）"
    : "墨消しした箇所は無い",
});
