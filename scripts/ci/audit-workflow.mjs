#!/usr/bin/env node
// 定期監査（security.yml）の実績を audit-workflow.json の形で出す: { schedule, last_success_at, artifact }。
//   node scripts/ci/audit-workflow.mjs <snapshot-dir> <owner/repo>
// schedule は workflow ファイルの cron、last_success_at は schedule イベントで最後に成功した run の完了時刻（無ければ null）。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const [, , , repo] = process.argv;
const file = ".github/workflows/security.yml";
const cron = existsSync(file)
  ? /cron:\s*["']?([^"'\n]+)/.exec(readFileSync(file, "utf8"))?.[1]?.trim()
  : null;

function lastSuccess() {
  try {
    const args = [
      "run",
      "list",
      "-R",
      repo,
      "--workflow",
      "security.yml",
      "--event",
      "schedule",
      "--status",
      "success",
      "--limit",
      "1",
    ];
    const rows = JSON.parse(execFileSync("gh", [...args, "--json", "updatedAt"], { encoding: "utf8" }));
    return rows[0]?.updatedAt ?? null;
  } catch {
    return null;
  }
}

process.stdout.write(
  `${JSON.stringify({ schedule: cron ?? null, last_success_at: lastSuccess(), artifact: "security-findings（findings.json・gate.json）、security-scan-*（SARIF・JSON・SBOM・scan-run.json）" }, null, 2)}\n`,
);
