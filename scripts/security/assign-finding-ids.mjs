#!/usr/bin/env node
// findings.json（triage の出力）のうち、台帳（security/finding-ids.yaml）に無い fingerprint に FND-nnn を振る。
//   node scripts/security/assign-finding-ids.mjs --findings docs/evidence/security/security-findings/findings.json          # 何を振るかを表示
//   node scripts/security/assign-finding-ids.mjs --findings <findings.json> --write                                        # 台帳に追記（人が実行して commit する）
// 既存の番号は変えない。番号は最大値の次から順に振り、解消した検出の番号も再利用しない。
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { LEDGER_PATH, allocate, loadFindingIds, renderLedger } from "./lib/finding-ids.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["write"] });
const root = resolve(args.root ?? ".");
const doc = JSON.parse(readFileSync(args.findings, "utf8"));
const entries = loadFindingIds(root);
const added = allocate(entries, doc.findings ?? [], new Date().toISOString().slice(0, 10));

for (const a of added)
  process.stdout.write(`${a.id}  ${a.fingerprint}  ${a.tool} ${a.rule_id} ${a.location}\n`);
process.stdout.write(`新しく振る ID: ${added.length} 件（台帳は ${entries.length} 件）\n`);
if (args.write && added.length > 0) {
  writeFileSync(join(root, LEDGER_PATH), renderLedger([...entries, ...added]));
  process.stdout.write(`${LEDGER_PATH} に追記した。内容を確認して commit する\n`);
}
