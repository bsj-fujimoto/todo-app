// docs/evidence/manifest.json: 取得した証跡の管理対象ファイルごとの path / sha256 / size / captured_at / source / version / head_sha。
// 形式は scripts/ci/lib/docs-checks.mjs（checkManifest）が読むもの（files[].path は docs/evidence からの相対、sha256 は 16 進）に合わせる。
// 管理対象: docs/evidence/{runs,security,perf,monitoring,github}/ の全ファイル（各ディレクトリの SOURCE.json を含む）。
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readJson, sha256 } from "./common.mjs";
import { DERIVED_TABLES, listManagedFiles, sourceOf } from "./evidence-files.mjs";

export const MANIFEST_FILE = "manifest.json";

/** 取り込み時に墨消ししたファイルなら、その記録（SOURCE.json の redactions。path は SOURCE.json のあるディレクトリからの相対）。 */
function redactionOf(source, rel) {
  const inner = rel
    .split("/")
    .slice(rel.startsWith("runs/") ? 2 : 1)
    .join("/");
  return (source.redactions ?? []).find((r) => r.path === inner) ?? null;
}

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
    ...redactedFrom(redactionOf(source, rel)),
    ...supersededFrom(source),
  };
}

/** 後の run に置き換えられた証跡（SOURCE.json の superseded_by）は、置き換えた run の id を持つ（実施表の根拠ではない印）。 */
const supersededFrom = (source) =>
  source.superseded_by?.run_id ? { superseded_by: String(source.superseded_by.run_id) } : {};

/** 墨消しした項目は、元ファイルの sha256 を持つ（manifest の sha256 は墨消し後。元との対応が追える）。 */
const redactedFrom = (r) => (r ? { redacted: true, original_sha256: r.original_sha256 } : {});

export function buildManifestFiles(evidenceDir) {
  return listManagedFiles(evidenceDir).map((rel) => entryFor(evidenceDir, rel));
}

/**
 * 機械生成の表（docs/data/api-results.csv・deviations.csv）の記録。取得した証跡ではなく派生物なので files には入れず、別に持つ。
 * path は repo ルートからの相対。生成元のスクリプトと sha256 を残し、表を手で書き換えたことを検知できるようにする。
 */
export function buildDerived(root) {
  return DERIVED_TABLES.filter((t) => existsSync(join(root, t.path))).map((t) => {
    const buffer = readFileSync(join(root, t.path));
    return { path: t.path, sha256: sha256(buffer), size: buffer.length, generated_by: t.by };
  });
}

export function buildManifest(files, nowIso, derived = []) {
  return {
    schema_version: 1,
    generated_at: nowIso,
    root: "docs/evidence",
    algorithm: "sha256",
    count: files.length,
    files,
    derived,
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

/** 機械生成の表が、記録した sha256 のままか。root は repo ルート。 */
function derivedProblems(root, manifest) {
  return (manifest.derived ?? []).flatMap((d) => {
    const file = join(root, d.path);
    if (!existsSync(file)) return [`欠落（派生表）: ${d.path}`];
    return sha256(readFileSync(file)) === d.sha256
      ? []
      : [`sha256 不一致（派生表。${d.generated_by} で再生成したか、手で書き換えたか）: ${d.path}`];
  });
}

export function verifyManifest(evidenceDir, manifest, root = join(evidenceDir, "..", "..")) {
  const entries = manifest.files ?? [];
  const registered = new Set(entries.map((e) => e.path));
  const unregistered = listManagedFiles(evidenceDir).filter((r) => !registered.has(r));
  return [
    ...entries.flatMap((e) => entryProblems(evidenceDir, e)),
    ...unregistered.map((rel) => `未登録: ${rel}`),
    ...derivedProblems(root, manifest),
  ];
}

/** 内容（files）が同じか。同じなら manifest を書き換えない（generated_at を動かさない＝冪等）。 */
export const sameFiles = (a, b, derived = []) =>
  Boolean(a) &&
  JSON.stringify(a.files) === JSON.stringify(b) &&
  JSON.stringify(a.derived ?? []) === JSON.stringify(derived);
