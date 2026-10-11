// docs/evidence/manifest.json: 取得した証跡の管理対象ファイルごとの path / sha256 / size / captured_at / source / version / head_sha。
// 形式は scripts/ci/lib/docs-checks.mjs（checkManifest）が読むもの（files[].path は docs/evidence からの相対、sha256 は 16 進）に合わせる。
// 管理対象: docs/evidence/{runs,security,perf,monitoring,github}/ の全ファイル（各ディレクトリの SOURCE.json を含む）。
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readJson, sha256 } from "./common.mjs";
import { listManagedFiles, sourceOf } from "./evidence-files.mjs";

export const MANIFEST_FILE = "manifest.json";

/** 1 ファイルの項目。取得元（SOURCE.json）が無いファイルは作れない（取得元不明の証跡を管理対象にしない）。 */
export function entryFor(evidenceDir, rel) {
  const source = sourceOf(evidenceDir, rel);
  if (!source)
    throw new Error(`${rel}: 取得元の SOURCE.json が無い（captured_at・source・head_sha を記録できない）`);
  const buffer = readFileSync(join(evidenceDir, rel));
  return {
    path: rel,
    sha256: sha256(buffer),
    size: buffer.length,
    captured_at: source.captured_at,
    source: source.source_url,
    version: source.version,
    head_sha: source.head_sha,
  };
}

export function buildManifestFiles(evidenceDir) {
  return listManagedFiles(evidenceDir).map((rel) => entryFor(evidenceDir, rel));
}

export function buildManifest(files, nowIso) {
  return {
    schema_version: 1,
    generated_at: nowIso,
    root: "docs/evidence",
    algorithm: "sha256",
    count: files.length,
    files,
  };
}

export const readManifest = (evidenceDir) => {
  const file = join(evidenceDir, MANIFEST_FILE);
  return existsSync(file) ? readJson(file) : null;
};

/** 全ファイルを再計算して、不一致・欠落・未登録・項目の欠けを返す（改変検知）。 */
function entryProblems(evidenceDir, e) {
  const file = join(evidenceDir, e.path);
  if (!existsSync(file)) return [`欠落: ${e.path}`];
  return [
    ...(sha256(readFileSync(file)) !== e.sha256 ? [`sha256 不一致（改変の疑い）: ${e.path}`] : []),
    ...(statSync(file).size !== e.size ? [`サイズ不一致: ${e.path}`] : []),
    ...["captured_at", "source", "version", "head_sha"]
      .filter((k) => !e[k])
      .map((k) => `${k} が空: ${e.path}`),
  ];
}

export function verifyManifest(evidenceDir, manifest) {
  const entries = manifest.files ?? [];
  const registered = new Set(entries.map((e) => e.path));
  const unregistered = listManagedFiles(evidenceDir).filter((r) => !registered.has(r));
  return [
    ...entries.flatMap((e) => entryProblems(evidenceDir, e)),
    ...unregistered.map((rel) => `未登録: ${rel}`),
  ];
}

/** 内容（files）が同じか。同じなら manifest を書き換えない（generated_at を動かさない＝冪等）。 */
export const sameFiles = (a, b) => Boolean(a) && JSON.stringify(a.files) === JSON.stringify(b);
