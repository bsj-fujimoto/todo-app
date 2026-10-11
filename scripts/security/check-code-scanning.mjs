#!/usr/bin/env node
// Code Scanning のアラート（GitHub 側）と、台帳 security/accepted-risks.yaml の受容のずれを検出する。ずれがあれば失敗する。
//   node scripts/security/check-code-scanning.mjs --repo owner/name [--out reports/code-scanning-check.json]
// gh api の read-only（GET）だけ。要: security-events: read（CI は triage ジョブ）。権限が無い・無効のときは、失敗にせず「確認できなかった」と明示して終了コード 0。
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { compareAlerts } from "./lib/code-scanning.mjs";
import { loadEntries } from "./lib/ledger.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const repo = args.repo ?? process.env.GITHUB_REPOSITORY;
const today = new Date().toISOString().slice(0, 10);

function fetchAlerts() {
  try {
    const out = execFileSync(
      "gh",
      ["api", `repos/${repo}/code-scanning/alerts?per_page=100`, "--paginate", "--slurp"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { alerts: JSON.parse(out).flat(), error: null };
  } catch (e) {
    return { alerts: [], error: String(e.stderr ?? e.message).split("\n")[0] };
  }
}

const { alerts, error } = fetchAlerts();
const accepted = loadEntries(root, "security/accepted-risks.yaml");
const result = error ? { problems: [], warnings: [], stats: {} } : compareAlerts(alerts, accepted, today);
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  repository: repo,
  error,
  ...result,
  result: error ? "unchecked" : result.problems.length ? "fail" : "pass",
};

if (args.out) {
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
}
const lines = [
  error
    ? `Code Scanning のアラートを取得できなかった（確認できていない）: ${error}`
    : `Code Scanning: アラート ${JSON.stringify(result.stats)} → ${report.result}`,
  ...result.problems.map((p) => `[FAIL] ${p}`),
  ...result.warnings.map((w) => `[WARN] ${w}`),
];
process.stdout.write(`${lines.join("\n")}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Code Scanning と台帳のずれ\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`,
  );
process.exitCode = result.problems.length ? 1 : 0;
