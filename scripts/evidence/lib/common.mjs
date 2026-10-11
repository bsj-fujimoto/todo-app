// 証跡ツール共通の小さな部品（依存ゼロ・純粋）。時刻・環境変数・ファイル入出力の実体は各 CLI（composition root）が持つ。
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const EVIDENCE_DIR = "docs/evidence";
export const DATA_DIR = "docs/data";
/** manifest が管理する、取得した証跡の置き場（docs/evidence の下）。 */
export const MANAGED_DIRS = ["runs", "security", "perf", "monitoring", "github"];

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
export const sha256File = (abs) => sha256(readFileSync(abs));
export const shortSha = (sha) => String(sha ?? "").slice(0, 7);
export const toPosix = (p) => p.replaceAll("\\", "/");

export const readJson = (abs) => JSON.parse(readFileSync(abs, "utf8"));

export function writeText(abs, text) {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

export const writeJson = (abs, value) => writeText(abs, `${JSON.stringify(value, null, 2)}\n`);

/** 失敗（exit 1）にする指摘と、警告にとどめる指摘をためる。 */
export function createReport() {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    error: (message) => errors.push(message),
    warn: (message) => warnings.push(message),
    get ok() {
      return errors.length === 0;
    },
  };
}

/** ISO 8601 の日付または日時か。 */
export const isIso = (value) =>
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(String(value));

export const idsIn = (text) =>
  String(text ?? "")
    .split(/[;,\s]+/)
    .filter(Boolean);

/** リポジトリ相対パスを絶対にする（root は呼び出し側が決める）。 */
export const abs = (root, rel) => join(root, rel);

export function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

/** 同じ値を 1 回だけ数える安定な重複排除。 */
export const uniq = (list) => [...new Set(list)];
