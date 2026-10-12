#!/usr/bin/env node
// 証拠索引 docs/data/evidence-index.csv を生成する。各主張・評価が file / anchor / run へ link する。
//   実施表・不具合表が使う EV（build-executions.mjs / build-defects.mjs が採番）を引き継ぎ、
//   docs/evidence/ の run 全体・セキュリティ（SARIF・SBOM・scan-run・findings・gate）・性能・監視・GitHub 統制の証拠を足す。
//   どこからも参照されない実施表由来の古い EV は落とす。解決しない参照・sha256 の不一致があれば失敗する（何も書かない）。
//   node scripts/evidence/build-evidence-index.mjs [--check]   # --check は書かずに、いまの索引が生成結果と一致するか確かめる
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { toCsv } from "../ci/lib/csv.mjs";
import { EVIDENCE_DIR, createReport, idsIn } from "./lib/common.mjs";
import { csvPath, loadEvidenceRows, loadFindingLedger, readTable, saveEvidenceRows } from "./lib/data-io.mjs";
import { checkEvidenceIndex } from "./lib/evidence-checks.mjs";
import { collectEvidenceEntries, derivedEntries } from "./lib/evidence-files.mjs";
import { readReleaseRecord } from "./lib/release-record.mjs";
import { EVIDENCE_COLUMNS, createRegistry } from "./lib/evidence-registry.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["check"] });
const root = resolve(args.root ?? ".");
const report = createReport();

const registry = createRegistry(loadEvidenceRows(root));
const fresh = new Set(
  [
    ...collectEvidenceEntries(join(root, EVIDENCE_DIR), loadFindingLedger(root)),
    ...derivedEntries(root, readReleaseRecord(root).data?.commit_sha),
  ].map((e) => registry.allocate(e)),
);
const referenced = new Set(
  ["executions", "defects"].flatMap((t) => readTable(root, t).rows.flatMap((r) => idsIn(r.evidence_ids))),
);
registry.prune((row) => fresh.has(row.evidence_id) || referenced.has(row.evidence_id));
const rows = registry.rows();

checkEvidenceIndex(root, rows, report);
for (const id of referenced)
  if (!registry.has(id)) report.error(`実施表・不具合表が参照する ${id} が索引に無い`);

if (!report.ok) {
  for (const e of report.errors) process.stderr.write(`エラー: ${e}\n`);
  process.exit(1);
}
if (args.check) {
  const current = readFileSync(csvPath(root, "evidence-index"), "utf8");
  if (current !== toCsv(EVIDENCE_COLUMNS, rows)) {
    process.stderr.write(
      "エラー: evidence-index.csv が生成結果と一致しない（node scripts/evidence/build-evidence-index.mjs で再生成する）\n",
    );
    process.exit(1);
  }
} else {
  saveEvidenceRows(root, rows);
}
const byDomain = Object.entries(Object.groupBy(rows, (r) => r.domain)).map(([d, v]) => `${d} ${v.length}`);
process.stdout.write(`evidence-index.csv: ${rows.length} 件（${byDomain.join(" / ")}）\n`);
