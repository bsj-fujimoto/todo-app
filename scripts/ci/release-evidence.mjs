#!/usr/bin/env node
// リリースの証跡（release-evidence/）を仕上げる: deploy-marker.json・images.json・RELEASE_NOTES.md・manifest.json（全ファイルの sha256）。
//   node scripts/ci/release-evidence.mjs --dir release-evidence --version v1.2.3 --sha <sha> --repo owner/name \
//     --run-url <url> --image backend=sha256:... --image frontend=sha256:... [--publish]
// 事前に release-evidence/ に ci-summary.json・security-findings/・security-scan-*/ などを置いておく（workflow が download-artifact で集める）。
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { asList, parseArgs } from "./lib/args.mjs";
import { sha256Of } from "./lib/artifacts.mjs";
import { deployMarker, imageRows, renderNotes } from "./lib/release-notes.mjs";

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

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );

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
  publish,
});
writeFileSync(join(dir, "RELEASE_NOTES.md"), notes);

// manifest は最後に作る（RELEASE_NOTES.md まで含めて sha256 を残す。manifest 自身は含めない）
const files = walk(dir)
  .sort()
  .map((p) => {
    const buf = readFileSync(p);
    return { path: relative(dir, p), bytes: buf.length, sha256: sha256Of(buf) };
  });
writeFileSync(
  join(dir, "manifest.json"),
  `${JSON.stringify({ schema_version: 1, version: args.version, commit_sha: args.sha, files }, null, 2)}\n`,
);
process.stdout.write(`${notes}\nmanifest: ${files.length} ファイル\n`);
