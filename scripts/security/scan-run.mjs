#!/usr/bin/env node
// 検査 1 回分の記録 scan-run.json を <out-dir>/ に書き、同じ出力の SARIF に対象・版・実行情報を追記する。
//   node scripts/security/scan-run.mjs --scan gitleaks --kind secret --tool gitleaks --tool-version 8.30.1 \
//     --image ghcr.io/gitleaks/gitleaks@sha256:... --command "gitleaks git ..." --config security/gitleaks.toml \
//     --started 2026-10-11T00:00:00Z --exit-code 0 --ok-codes 0 --out-dir security-results/gitleaks
// 保守性の検査（check_kind=maintainability）は --rule-class（complexity / size / params / purity。複数可）と --thresholds-json（ファイル）も付ける。
// scan.sh から呼ばれる。git の情報は環境変数（GitHub Actions）か git コマンドから取る。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asList, parseArgs } from "../ci/lib/args.mjs";
import { annotateFiles, outputFiles, sarifInfo } from "./lib/scan-run.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["skipped", "informational"] });
const env = process.env;
const git = (...a) => {
  try {
    return execFileSync("git", a, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

const repository = env.GITHUB_REPOSITORY
  ? `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY}`
  : (git("config", "--get", "remote.origin.url") ?? "")
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/\.git$/, "");
const target = {
  repository,
  branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || git("rev-parse", "--abbrev-ref", "HEAD"),
  commit_sha: env.TARGET_SHA || env.GITHUB_SHA || git("rev-parse", "HEAD"),
  image_digest: args["image-digest"] ?? null,
  image_digest_kind: args["image-digest-kind"] ?? null,
  images: asList(args["coverage-image"]),
};
const okCodes = String(args["ok-codes"] ?? "0")
  .split(",")
  .map(Number);
const exitCode = Number(args["exit-code"] ?? 0);
const finishedAt = new Date().toISOString();
const skipped = Boolean(args.skipped);

const base = {
  scan: args.scan,
  started_at: args.started,
  finished_at: finishedAt,
  command: args.command ?? null,
  config_ref: args.config ?? null,
  target,
  exit_ok: okCodes.includes(exitCode),
};
mkdirSync(args["out-dir"], { recursive: true });
annotateFiles(outputFiles(args["out-dir"]), base);
const files = outputFiles(args["out-dir"]);
const { results, tool } = sarifInfo(files);

const record = {
  schema_version: 1,
  scan: args.scan,
  check_kind: args.kind,
  tool: {
    name: args.tool ?? tool?.name ?? null,
    version: args["tool-version"] ?? tool?.version ?? null,
    image: args.image ?? null,
  },
  status: skipped ? "skipped" : base.exit_ok ? "ok" : "failed",
  skipped_reason: skipped ? (args.note ?? null) : null,
  target,
  started_at: args.started,
  finished_at: finishedAt,
  command: args.command ?? null,
  exit_code: exitCode,
  accepted_exit_codes: okCodes,
  config_ref: args.config ?? null,
  rules_ref: args.rules ?? null,
  exclusions: asList(args.exclusion),
  // --thresholds-json: ルールごとの閾値などの構造化した値（ファイルから読む）。無ければ --threshold の文字列
  thresholds: args["thresholds-json"]
    ? JSON.parse(readFileSync(args["thresholds-json"], "utf8"))
    : (args.threshold ?? null),
  rule_classes: asList(args["rule-class"]),
  coverage: {
    languages: asList(args["coverage-language"]),
    paths: asList(args["coverage-path"]),
    urls: asList(args["coverage-url"]),
    images: asList(args["coverage-image"]),
  },
  authenticated: args.authenticated === undefined ? null : args.authenticated === "true",
  workflow_ref: env.GITHUB_WORKFLOW_REF ?? null,
  run_url: env.GITHUB_RUN_ID
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : null,
  output_location: args["out-dir"],
  output_files: files,
  finding_count_sarif: results,
  informational: Boolean(args.informational),
  note: args.note ?? null,
};
writeFileSync(join(args["out-dir"], "scan-run.json"), `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(
  `scan-run: ${args.scan} → ${record.status}（exit ${exitCode}、SARIF 結果 ${results} 件、出力 ${files.length} ファイル）\n`,
);
process.exitCode = record.status === "failed" ? 1 : 0;
