#!/usr/bin/env node
// release-evidence.zip の個人情報・秘密情報の検査と、manifest の整合（sha256・redacted: true）の検査。見つかれば exit 1（publish を止める）。
//   node scripts/ci/check-release-evidence.mjs --zip release-evidence.zip [--repo owner/name] [--out reports/release-evidence-check.json]
// 検査の規則は scripts/evidence/lib/sensitive.mjs（証跡の検査と同じ）。値そのものは出さない（位置と規則だけ）。
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ownersOf } from "../evidence/lib/redact-files.mjs";
import { parseArgs } from "./lib/args.mjs";
import { checkReleaseFiles } from "./lib/release-check.mjs";
import { readTree, unzipTo } from "./lib/release-zip.mjs";

const args = parseArgs(process.argv.slice(2));
const tmp = mkdtempSync(join(tmpdir(), "release-evidence-check-"));
let result;
try {
  unzipTo(resolve(args.zip), tmp);
  result = checkReleaseFiles({ files: readTree(tmp), owners: ownersOf(args.repo) });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const report = {
  schema_version: 1,
  zip: args.zip,
  ...result,
  result: result.problems.length ? "fail" : "pass",
};
if (args.out) {
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
}
const lines = [
  `リリース証跡の検査: ${JSON.stringify(result.stats)} → ${report.result}`,
  ...result.problems.slice(0, 50).map((p) => `[FAIL] ${p}`),
  ...(result.problems.length > 50 ? [`[FAIL] ほか ${result.problems.length - 50} 件`] : []),
];
process.stdout.write(`${lines.join("\n")}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### リリース証跡の検査\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`,
  );
process.exitCode = result.problems.length ? 1 : 0;
