#!/usr/bin/env node
// docs/evidence/manifest.json の改変検知: 全ファイルの sha256・size を再計算し、不一致・欠落・未登録ファイルがあれば失敗する。
//   node scripts/evidence/verify-manifest.mjs [--root .]
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { EVIDENCE_DIR } from "./lib/common.mjs";
import { readManifest, verifyManifest } from "./lib/manifest.mjs";

const args = parseArgs(process.argv.slice(2));
const evidenceDir = join(resolve(args.root ?? "."), EVIDENCE_DIR);
const manifest = readManifest(evidenceDir);
if (!manifest) {
  process.stderr.write(
    "エラー: docs/evidence/manifest.json が無い（node scripts/evidence/build-manifest.mjs で作る）\n",
  );
  process.exit(1);
}
const problems = verifyManifest(evidenceDir, manifest);
for (const p of problems) process.stderr.write(`エラー: ${p}\n`);
process.stdout.write(
  `manifest: ${manifest.files.length} ファイルを検査 → ${problems.length ? `${problems.length} 件の問題` : "改変・欠落・未登録なし"}\n`,
);
process.exitCode = problems.length ? 1 : 0;
