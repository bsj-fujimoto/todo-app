#!/usr/bin/env node
// 検査結果（SARIF / JSON）を読み、重複排除・台帳の適用・前回との差分・ゲート判定をして findings.json を作る。
//   node scripts/security/triage.mjs --results security-results --out security-findings [--previous prev/findings.json]
// ゲート: critical / high の未解決（untriaged / tp）、受容できない重大度の受容・期限切れ、期待した検査の欠落、台帳の不備 → exit 1。
// 文脈（到達可能性・公開範囲・資産影響・補完統制）と是正案は security/triage.yaml（人が書く）から取り込む。機械は作らない。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { isFile, readText } from "../ci/lib/repo-fs.mjs";
import { parseYaml } from "../ci/lib/yaml-lite.mjs";
import { collectScans } from "./lib/collect.mjs";
import { buildDocument } from "./lib/document.mjs";
import { loadFindingIds } from "./lib/finding-ids.mjs";
import { loadEntries } from "./lib/ledger.mjs";
import { renderSummary } from "./lib/triage.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const now = new Date();
const env = process.env;

const expectedPath = args.expected ?? "security/expected-scans.yaml";
const expected = isFile(root, expectedPath)
  ? ((parseYaml(readText(root, expectedPath)) ?? {}).scans ?? [])
  : [];
const previous =
  args.previous && existsSync(args.previous) ? JSON.parse(readFileSync(args.previous, "utf8")) : null;

const doc = buildDocument({
  scans: collectScans(args.results),
  ledgers: {
    triage: loadEntries(root, "security/triage.yaml"),
    accepted: loadEntries(root, "security/accepted-risks.yaml"),
    today: now.toISOString().slice(0, 10),
  },
  previous,
  findingIds: loadFindingIds(root),
  expected,
  today: now.toISOString().slice(0, 10),
  nowIso: now.toISOString(),
  run: {
    run_url: env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : null,
  },
});

mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, "findings.json"), `${JSON.stringify(doc, null, 2)}\n`);
writeFileSync(
  join(args.out, "gate.json"),
  `${JSON.stringify({ commit_sha: doc.target.commit_sha, generated_at: doc.generated_at, ...doc.gate, missing_scans: doc.missing_scans }, null, 2)}\n`,
);
const md = renderSummary(doc);
writeFileSync(join(args.out, "triage-summary.md"), md);
process.stdout.write(md);
for (const s of doc.stale_ledger_entries) process.stdout.write(`注意: ${s}\n`);
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md);
process.exitCode = doc.gate.result === "fail" ? 1 : 0;
