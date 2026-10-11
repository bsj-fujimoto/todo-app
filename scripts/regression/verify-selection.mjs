#!/usr/bin/env node
// 選択ロジックの漏れ検証（フル回帰の定期確認）。
//   node scripts/regression/verify-selection.mjs --selection regression-selection.json --summary ci-summary.json --out selection-audit.json
// 「直近の変更から select.mjs が選んだケース」と「全件回帰で実際に落ちたケース」を突き合わせ、
// 全件では落ちたのに選択では外れていたケース（= 選択ロジックの漏れ）を記録する。落ちたものが無ければ漏れは検出されなかった、と記録する。
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["strict"] });
const selection = JSON.parse(readFileSync(args.selection, "utf8"));
const summary = JSON.parse(readFileSync(args.summary, "utf8"));

const failed = Object.entries(summary.test_cases)
  .filter(([, r]) => r.status === "failed")
  .map(([id]) => id);
const selected = new Set(selection.selected_case_ids);
const leaks = selection.mode === "selected" ? failed.filter((id) => !selected.has(id)) : [];

const audit = {
  schema_version: 1,
  commit_sha: summary.commit_sha,
  generated_at: new Date().toISOString(),
  selection_base: selection.base,
  selection_mode: selection.mode,
  selected_cases: selection.selected_case_ids.length,
  full_run_cases: Object.keys(summary.test_cases).length,
  full_run_failed: failed,
  leaks,
  result: leaks.length ? "leak_detected" : "no_leak_detected",
  note:
    selection.mode === "full"
      ? "直近の変更は全件実行にフォールバックする内容だったため、選択ロジックの検証対象外"
      : "選択結果と全件回帰の失敗を突き合わせた",
};
mkdirSync(dirname(resolve(args.out)), { recursive: true });
writeFileSync(args.out, `${JSON.stringify(audit, null, 2)}\n`);
const md = `### 選択ロジックの検証\n\n- 結果: **${audit.result}**（選択 ${audit.selected_cases} / 全件 ${audit.full_run_cases} / 全件で失敗 ${failed.length}）\n- 漏れ: ${leaks.join(", ") || "なし"}\n- ${audit.note}\n`;
process.stdout.write(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
process.exitCode = args.strict && leaks.length ? 1 : 0;
