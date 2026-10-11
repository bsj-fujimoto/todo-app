#!/usr/bin/env node
// リリースの証跡（release-evidence/）を仕上げる: deploy-marker.json・images.json・RELEASE_NOTES.md・manifest.json（全ファイルの sha256）。
//   node scripts/ci/release-evidence.mjs --dir release-evidence --version v1.2.3 --sha <sha> --repo owner/name \
//     --run-url <url> --image backend=sha256:... --image frontend=sha256:... [--publish]
// zip に入れる前に墨消しし（scripts/evidence/lib/redact*.mjs を共有）、manifest.json に redacted: true・元 sha256・墨消し後 sha256・件数を残す。
// 事前に release-evidence/ に ci-summary.json・security-findings/・security-scan-*/ などを置いておく（workflow が download-artifact で集める）。
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asList, parseArgs } from "./lib/args.mjs";
import { buildManifest, redactRelease } from "./lib/release-redact.mjs";
import { deployMarker, imageRows, renderNotes } from "./lib/release-notes.mjs";
import { ownersOf } from "../evidence/lib/redact-files.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["publish"] });
const dir = args.dir;
const publish = Boolean(args.publish);
const images = Object.fromEntries(asList(args.image).map((i) => i.split("=")));
const rows = imageRows(images, args.version, args.sha.slice(0, 7));
const read = (rel) => (existsSync(join(dir, rel)) ? JSON.parse(readFileSync(join(dir, rel), "utf8")) : null);

function gateSummary() {
  const f = read("security-findings/findings.json");
  if (!f) return null;
  const by = Object.entries(f.summary.by_severity)
    .map(([k, v]) => `${k} ${v}`)
    .join(" / ");
  return { result: f.gate.result, total: f.findings.length, by_severity: by || "検出なし" };
}

// 公開した digest に対する trivy の検査（release.yml が published-scans/ に書く）と、その triage の結果
function publishedScans() {
  const base = join(dir, "published-scans");
  if (!existsSync(base)) return null;
  const scans = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => read(`published-scans/${e.name}/scan-run.json`))
    .filter(Boolean)
    .map((r) => ({
      scan: r.scan,
      digest: r.target?.image_digest ?? null,
      status: r.status,
      findings: r.finding_count_sarif,
    }));
  const f = read("published-scans-findings/findings.json");
  return { scans, gate: f ? f.gate : null };
}

writeFileSync(
  join(dir, "images.json"),
  `${JSON.stringify({ version: args.version, commit_sha: args.sha, images: rows }, null, 2)}\n`,
);
writeFileSync(
  join(dir, "deploy-marker.json"),
  `${JSON.stringify(deployMarker({ version: args.version, sha: args.sha, rows, runUrl: args["run-url"], nowIso: new Date().toISOString(), publish }), null, 2)}\n`,
);
const notes = renderNotes({
  version: args.version,
  sha: args.sha,
  repo: args.repo,
  runUrl: args["run-url"],
  rows,
  summary: read("ci-summary/ci-summary.json"),
  gate: gateSummary(),
  published: publishedScans(),
  publish,
});
writeFileSync(join(dir, "RELEASE_NOTES.md"), notes);

// zip に入れる前に墨消しする（人の氏名・メール・アカウント名・秘密情報らしい値。規則は証跡の取り込みと同じ）。
// manifest は最後に作る（墨消し後のファイルの sha256、墨消しした記録を残す。manifest 自身は含めない）
const records = redactRelease(dir, ownersOf(args.repo));
const manifest = buildManifest({ dir, version: args.version, sha: args.sha, records });
writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `${notes}\nmanifest: ${manifest.files.length} ファイル、墨消し ${records.length} ファイル・${manifest.redaction.replacements} 箇所\n`,
);
