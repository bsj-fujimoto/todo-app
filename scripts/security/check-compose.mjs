#!/usr/bin/env node
// docker compose の構成の設定誤りを検査して SARIF にする（標準入力に `docker compose config --format json`）。
//   docker compose -f docker-compose.yml config --format json | node scripts/security/check-compose.mjs --file docker-compose.yml --out security-results/compose/compose-check.sarif
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { checkCompose, composeToSarif } from "./lib/compose.mjs";

const args = parseArgs(process.argv.slice(2));
const config = JSON.parse(readFileSync(0, "utf8"));
const hits = checkCompose(config);
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(
  args.out,
  `${JSON.stringify(composeToSarif(hits, args.file ?? "docker-compose.yml", new Date().toISOString()), null, 2)}\n`,
);
process.stdout.write(
  `compose-check: ${Object.keys(config.services ?? {}).length} サービスを検査、指摘 ${hits.length} 件 → ${args.out}\n`,
);
