// 監視対象の要約（Markdown）を標準出力に出す（synthetic.yml の step summary 用）。
// 使い方: node scripts/monitoring/target-summary.mjs monitoring/out/target.json
import { readFileSync } from "node:fs";
import { renderTargetSummary } from "./lib/summary.mjs";

process.stdout.write(renderTargetSummary(JSON.parse(readFileSync(process.argv[2], "utf8"))));
