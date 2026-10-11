// 取得する証跡の種類ごとの、取り込む artifact・ファイルの規則（security / perf / monitoring / github）。
// CI の実行成果物（kind=ci）は run-layout.mjs。ここは「最新の 1 組を置き換える」ディレクトリ用。
import { toPosix } from "./common.mjs";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * artifact: 取り込む artifact 名（最上位ディレクトリ）の正規表現。file: 取り込むファイル名の正規表現。
 * 取り込んだファイルは docs/evidence/<dir>/<artifact 名>/<artifact 内の相対パス> に置く。
 */
export const KINDS = {
  security: {
    dir: "security",
    artifact: /^security-/,
    file: /(\.sarif|\.cdx\.json|(^|\/)sbom[^/]*\.json|(^|\/)scan-run\.json|(^|\/)findings\.json|(^|\/)gate\.json|(^|\/)triage-summary\.md)$/,
  },
  perf: { dir: "perf", artifact: /^perf/, file: /\.(json|jsonl|md)$/ },
  monitoring: { dir: "monitoring", artifact: /^(monitoring|synthetic)/, file: /\.(json|jsonl|md)$/ },
  github: { dir: "github", artifact: /.*/, file: /\.json$/ },
};

/** 相対パスの一覧 → コピー計画 [{ from, to }]。sizeOf は大きすぎるファイルを除くために使う。 */
export function planKindFiles(kind, relPaths, sizeOf = () => 0) {
  const rule = KINDS[kind];
  if (!rule) throw new Error(`未知の種類: ${kind}（${Object.keys(KINDS).join(" / ")}）`);
  const plan = [];
  const skipped = [];
  for (const from of relPaths.map(toPosix).sort()) {
    const [artifact] = from.split("/");
    if (!rule.artifact.test(artifact) || !rule.file.test(from)) continue;
    if (sizeOf(from) > MAX_FILE_BYTES) skipped.push({ path: from, reason: `${MAX_FILE_BYTES} バイト超` });
    else plan.push({ from, to: from });
  }
  return { plan, skipped };
}
