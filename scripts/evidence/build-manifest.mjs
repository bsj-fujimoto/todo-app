#!/usr/bin/env node
// docs/evidence/manifest.json を生成する（管理対象ファイルごとの sha256・size・取得時刻・取得元 run の URL・版・対象 SHA）。
//   node scripts/evidence/build-manifest.mjs
// 内容が変わらなければ書き換えない（冪等）。取得元（SOURCE.json）の無いファイルがあれば失敗する。
// verify-manifest.mjs が全ファイルを再計算して改変・欠落・未登録を検出する（scripts/ci/docs-check.mjs も同じ manifest を検証する）。
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { EVIDENCE_DIR, writeJson } from "./lib/common.mjs";
import {
  MANIFEST_FILE,
  buildManifest,
  buildManifestFiles,
  readManifest,
  sameFiles,
} from "./lib/manifest.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const evidenceDir = join(root, EVIDENCE_DIR);

const files = buildManifestFiles(evidenceDir);
const previous = readManifest(evidenceDir);
if (sameFiles(previous, files)) {
  process.stdout.write(`manifest.json: 変更なし（${files.length} ファイル）\n`);
} else {
  writeJson(join(evidenceDir, MANIFEST_FILE), buildManifest(files, new Date().toISOString()));
  process.stdout.write(`manifest.json: ${files.length} ファイルを記録した\n`);
}
