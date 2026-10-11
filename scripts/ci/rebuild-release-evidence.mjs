#!/usr/bin/env node
// 公開済みリリースの release-evidence.zip を、墨消し済みで作り直す（既存の添付の差し替え用）。
//   node scripts/ci/rebuild-release-evidence.mjs --run 38152472087 --out <dir> [--repo owner/name]
//   node scripts/ci/rebuild-release-evidence.mjs --from <gh run download の出力> --out <dir>   # 取得済みの artifact を使う
// 手順: 元の run の artifact `release-evidence`（墨消し前の release-evidence.zip）を取得 → 展開 → 墨消し（release-evidence.mjs と同じ処理）→
//   manifest.json を作り直す（redacted: true・元 sha256・墨消し後 sha256・件数）→ zip → 検査（check-release-evidence.mjs と同じ検査）。
// 出力: <dir>/release-evidence.zip（これを `gh release upload <tag> <dir>/release-evidence.zip --clobber` で差し替える）、<dir>/rebuild-report.json。
// 検査に失敗したら exit 1（差し替えない）。元の取得物は <dir>/original/ に残る（個人情報を含む。コミットしない）。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ownersOf } from "../evidence/lib/redact-files.mjs";
import { parseArgs } from "./lib/args.mjs";
import { sha256Of } from "./lib/artifacts.mjs";
import { checkReleaseFiles } from "./lib/release-check.mjs";
import { MANIFEST, buildManifest, redactRelease } from "./lib/release-redact.mjs";
import { readTree, unzipTo, zipDir } from "./lib/release-zip.mjs";

const args = parseArgs(process.argv.slice(2));
const out = resolve(args.out);
const original = join(out, "original");
const work = join(out, "release-evidence");
const zip = join(out, "release-evidence.zip");

function fetchOriginal() {
  if (args.from) return resolve(args.from);
  const repo = args.repo ? ["--repo", args.repo] : [];
  const r = spawnSync(
    "gh",
    ["run", "download", String(args.run), ...repo, "-n", "release-evidence", "-D", original],
    {
      encoding: "utf8",
    },
  );
  if (r.status !== 0) throw new Error(`artifact release-evidence を取得できない: ${r.stderr}`);
  return original;
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

rmSync(work, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(out, { recursive: true });
const source = fetchOriginal();
const originalZip = join(source, "release-evidence.zip");
if (!existsSync(originalZip)) throw new Error(`${originalZip} が無い`);
mkdirSync(work, { recursive: true });
unzipTo(originalZip, work);

const old = readJson(join(work, MANIFEST));
const marker = existsSync(join(work, "deploy-marker.json")) ? readJson(join(work, "deploy-marker.json")) : {};
const owners = ownersOf(args.repo ?? marker.run_url);
rmSync(join(work, MANIFEST));
const records = redactRelease(work, owners);
const manifest = buildManifest({ dir: work, version: old.version, sha: old.commit_sha, records });
writeFileSync(join(work, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
zipDir(work, zip);

const check = checkReleaseFiles({ files: readTree(work), owners });
const report = {
  schema_version: 1,
  version: old.version,
  commit_sha: old.commit_sha,
  source_run: args.run ?? null,
  original_zip_sha256: sha256Of(readFileSync(originalZip)),
  redacted_zip_sha256: sha256Of(readFileSync(zip)),
  files_changed: records.length,
  replacements: manifest.redaction.replacements,
  result: check.problems.length ? "fail" : "pass",
  problems: check.problems,
  stats: check.stats,
};
writeFileSync(join(out, "rebuild-report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `${old.version} の release-evidence.zip を墨消し済みで作り直した: ${records.length} ファイル・${manifest.redaction.replacements} 箇所を置換\n` +
    `検査: ${JSON.stringify(check.stats)} → ${report.result}\n` +
    `${check.problems
      .slice(0, 20)
      .map((p) => `[FAIL] ${p}`)
      .join("\n")}\n出力: ${zip}\n`,
);
process.exitCode = check.problems.length ? 1 : 0;
