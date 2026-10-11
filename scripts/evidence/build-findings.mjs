#!/usr/bin/env node
// セキュリティ検出の表 docs/data/findings.csv を生成する（元: docs/evidence/security/**/findings.json。security.yml の triage の出力）。
//   node scripts/evidence/build-findings.mjs
// finding_id は triage の F-001 を FND-001 に写して定義する（FND を参照する表が docs-check の ID 解決を通るように）。
// findings.json が無ければ表は作らない（セキュリティの証跡を fetch-run.mjs --kind security で取り込んでから）。
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { EVIDENCE_DIR, readJson } from "./lib/common.mjs";
import { writeTable } from "./lib/data-io.mjs";
import { FINDING_COLUMNS, findingRows } from "./lib/findings-table.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const source = join(root, EVIDENCE_DIR, "security/security-findings/findings.json");
if (!existsSync(source)) {
  process.stdout.write(
    "findings.csv: 元の findings.json が無いので作らない（fetch-run.mjs --kind security で取り込む）\n",
  );
} else {
  const rows = findingRows(readJson(source));
  writeTable(root, "findings", FINDING_COLUMNS, rows);
  const byStatus = Object.entries(Object.groupBy(rows, (r) => r.status)).map(([k, v]) => `${k} ${v.length}`);
  process.stdout.write(`findings.csv: ${rows.length} 件（${byStatus.join(" / ")}）\n`);
}
