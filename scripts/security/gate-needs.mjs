#!/usr/bin/env node
// security-result の判定。NEEDS_JSON（toJSON(needs)）と EVENT（github.event_name）を読み、success 以外があれば失敗する。
import { appendFileSync } from "node:fs";
import { judge } from "./lib/gate.mjs";

const needs = JSON.parse(process.env.NEEDS_JSON ?? "{}");
const { rows, pass } = judge(needs, process.env.EVENT ?? "");
const table = [
  "| ジョブ | 結果 | 判定 |",
  "|---|---|---|",
  ...rows.map((r) => `| ${r.job} | ${r.result} | ${r.ok ? "OK" : "NG"}${r.note ? `（${r.note}）` : ""} |`),
];
const md = `### security-result\n\n- 対象 SHA: \`${process.env.TARGET_SHA ?? process.env.GITHUB_SHA}\`\n\n${table.join("\n")}\n`;
process.stdout.write(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
process.exitCode = pass ? 0 : 1;
