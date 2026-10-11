#!/usr/bin/env node
// flaky-report.json の issue_candidates から、ラベル `flaky` の Issue を起票する（同名の open Issue があれば作らない）。
//   node scripts/regression/flaky-issues.mjs --report flaky-report.json [--dry-run]
// gh と GH_TOKEN（issues: write）が要る。--dry-run は何も作らず、作る予定だけを表示する。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "../ci/lib/args.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["dry-run"] });
const report = JSON.parse(readFileSync(args.report, "utf8"));
const gh = (...a) => execFileSync("gh", a, { encoding: "utf8" });

const titles = args["dry-run"]
  ? new Set()
  : new Set(
      JSON.parse(
        gh("issue", "list", "--label", "flaky", "--state", "open", "--limit", "200", "--json", "title"),
      ).map((i) => i.title),
    );
const todo = report.issue_candidates.filter((c) => !titles.has(c.title));
process.stdout.write(
  `flaky 候補 ${report.issue_candidates.length} 件のうち、起票するもの ${todo.length} 件\n`,
);

if (!args["dry-run"] && todo.length > 0) {
  gh(
    "label",
    "create",
    "flaky",
    "--color",
    "fbca04",
    "--description",
    "不安定なテスト（同一 SHA で pass/fail 混在）",
    "--force",
  );
}
for (const c of todo) {
  process.stdout.write(`- ${c.title}\n`);
  if (!args["dry-run"])
    gh("issue", "create", "--title", c.title, "--body", c.body, "--label", c.labels.join(","));
}
