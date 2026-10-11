// リリース証跡 zip の検査（純粋関数）。墨消し漏れ（メール・氏名・メンション・秘密情報らしい値）と、manifest の整合を検査する。
// 検査の規則は証跡の検査（scripts/evidence/lib/sensitive.mjs）と同じ。見つかったら publish を止める。
import { scanFiles } from "../../evidence/lib/sensitive.mjs";
import { sha256Of } from "./artifacts.mjs";

const TEXT_EXT = /\.(json|sarif|jsonl|md|xml|txt|ya?ml|csv|tsv|html|log)$/;

const listedProblem = (path, listed, files) => {
  const buf = files.get(path);
  if (!buf) return [`manifest にあるファイルが zip に無い: ${path}`];
  return sha256Of(buf) === listed.sha256 ? [] : [`sha256 が manifest と一致しない: ${path}`];
};

const extraProblems = (files, listed) =>
  [...files.keys()]
    .filter((p) => p !== "manifest.json" && !listed.has(p))
    .map((p) => `zip にあるファイルが manifest に無い: ${p}`);

const redactionProblems = (manifest, listed) =>
  (manifest.redactions ?? [])
    .filter((r) => listed.get(r.path)?.sha256 !== r.redacted_sha256)
    .map((r) => `redactions の墨消し後 sha256 が files と一致しない: ${r.path}`);

function manifestProblems(manifest, files) {
  if (!manifest) return ["manifest.json が無い"];
  const listed = new Map((manifest.files ?? []).map((f) => [f.path, f]));
  return [
    ...(manifest.redacted === true ? [] : ["manifest.json に redacted: true が無い（墨消しを通っていない）"]),
    ...[...listed].flatMap(([path, f]) => listedProblem(path, f, files)),
    ...extraProblems(files, listed),
    ...redactionProblems(manifest, listed),
  ];
}

const parseManifest = (buf) => (buf ? JSON.parse(buf.toString("utf8")) : null);

/** files: Map(path → Buffer)（zip の全ファイル）。owners: リポジトリのオーナー名。 */
export function checkReleaseFiles({ files, owners = [] }) {
  const manifest = parseManifest(files.get("manifest.json"));
  const texts = [...files]
    .filter(([path]) => TEXT_EXT.test(path))
    .map(([path, buf]) => ({ path, text: buf.toString("utf8") }));
  const { hits } = scanFiles(texts, { owners });
  const problems = [
    ...manifestProblems(manifest, files),
    ...hits.map((h) => `${h.path}:${h.line} 個人情報・秘密情報らしい値（${h.rule}）${h.sample}`),
  ];
  const redaction = manifest?.redaction ?? {};
  return {
    problems,
    stats: {
      files: files.size,
      text_files: texts.length,
      pii_hits: hits.length,
      redacted: manifest?.redacted === true,
      redacted_files: redaction.files_changed ?? 0,
      replacements: redaction.replacements ?? 0,
    },
  };
}
