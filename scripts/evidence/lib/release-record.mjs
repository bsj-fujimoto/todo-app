// リリースの記録 docs/evidence/release.json: どのリリース（版・タグ）が、テストした製品 commit X・イメージ digest・run の何かを指す。
// 運用: タグは必ず「テストした製品 commit X」に打つ。実施表・証跡は X の run から作り、あとで commit Y として main に入れる。
// release.json は取り込み時に（人が）書く。Y 以降の CI（ci.yml の docs-check）は、release.json があれば X を --release に、--strict で検査する
// （実施表の全行の commit_sha が X と一致し、版の混在が無いこと）。無ければ従来どおり（非 strict）で、「スキップ」と明示する。純粋関数。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const RELEASE_RECORD = "docs/evidence/release.json";
const VERSION = /^v\d+\.\d+\.\d+$/;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function readReleaseRecord(root) {
  const file = join(root, RELEASE_RECORD);
  if (!existsSync(file)) return { exists: false, data: null, error: null };
  try {
    return { exists: true, data: JSON.parse(readFileSync(file, "utf8")), error: null };
  } catch (e) {
    return { exists: true, data: null, error: `${RELEASE_RECORD} が JSON として読めない: ${e.message}` };
  }
}

const imageProblems = (images) =>
  ["backend", "frontend"]
    .filter((n) => !DIGEST.test(String(images?.[n] ?? "")))
    .map((n) => `images.${n} が sha256:<64 桁> の digest でない`);

const CHECKS = [
  [(r) => !VERSION.test(String(r.release ?? "")), "release が vX.Y.Z の形でない"],
  [(r) => !VERSION.test(String(r.tag ?? "")), "tag が vX.Y.Z の形でない"],
  [(r) => r.release && r.tag && r.release !== r.tag, "release と tag が違う"],
  [
    (r) => !SHA.test(String(r.commit_sha ?? "")),
    "commit_sha が 40 桁の SHA でない（テストした製品 commit X を書く）",
  ],
  [(r) => !/^\d+$/.test(String(r.run_id ?? "")), "run_id が数字でない"],
  [(r) => Number.isNaN(Date.parse(String(r.recorded_at ?? ""))), "recorded_at が日時でない"],
];

/** 形式の検査。問題の説明の配列（空なら正しい）。 */
export const validateReleaseRecord = (rec) => [
  ...CHECKS.filter(([bad]) => bad(rec)).map(([, message]) => message),
  ...imageProblems(rec.images),
];

/**
 * check-evidence に渡す版の固定。--structure-only（release.yml の構造検査）では使わない。
 * 優先: --release の指定 > release.json の commit_sha。release.json が正しければ strict にする。
 */
export function releasePlan({ record, releaseArg, strictArg, structureOnly }) {
  const plain = { release: releaseArg ?? null, strict: Boolean(strictArg), source: null };
  if (structureOnly || !record.exists) return plain;
  const valid = Boolean(record.data) && validateReleaseRecord(record.data).length === 0;
  if (!valid) return plain;
  return { release: releaseArg ?? record.data.commit_sha, strict: true, source: RELEASE_RECORD };
}

/** check-evidence の 1 項目（無ければ skipped と理由、あれば形式を検査）。 */
export function releaseRecordCheck(record, plan, structureOnly) {
  const title =
    "リリースの記録（release.json）の形式。あれば、その commit を --release に --strict で検査する";
  const base = { id: "release-record", title, warnings: [], stats: {} };
  if (structureOnly) {
    return {
      ...base,
      status: "skipped",
      messages: ["構造検査のみ（--structure-only）。release.json による版の固定はしない"],
    };
  }
  if (!record.exists) {
    return {
      ...base,
      status: "skipped",
      messages: [`${RELEASE_RECORD} が無い（リリースの証跡を取り込むまではスキップ。非 strict で検査する）`],
    };
  }
  const problems = record.error ? [record.error] : validateReleaseRecord(record.data);
  return {
    ...base,
    status: problems.length ? "fail" : "pass",
    messages: problems.map((p) => `${RELEASE_RECORD}: ${p}`),
    stats: { release: record.data?.release ?? null, commit_sha: plan.release, strict: plan.strict },
  };
}
