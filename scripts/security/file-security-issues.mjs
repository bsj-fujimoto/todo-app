#!/usr/bin/env node
// medium の未解決の検出を Issue にする（ラベル security）。同じ指紋の Issue（open / closed）があれば新規には作らない。
//   node scripts/security/file-security-issues.mjs --findings security-findings/findings.json [--run-url <url>] [--comment-existing] [--dry-run]
//   既存が closed なら開き直してコメントする。open は --comment-existing（定期実行）のときだけ経過をコメントする。
// 重大度ポリシー: medium は Issue 化して、90 日以内に修正するか、security/accepted-risks.yaml に期限付きで受容する。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "../ci/lib/args.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["dry-run", "comment-existing"] });
const doc = JSON.parse(readFileSync(args.findings, "utf8"));
const gh = (...a) => execFileSync("gh", a, { encoding: "utf8" });

const targets = doc.findings.filter((f) => f.severity === "medium" && ["untriaged", "tp"].includes(f.status));
// 重複させない: 指紋が題名にある Issue を（open でも closed でも）探す。あれば新規には作らず、経過をコメントする（closed なら開き直す）
const issues = args["dry-run"]
  ? []
  : JSON.parse(
      gh(
        "issue",
        "list",
        "--label",
        "security",
        "--state",
        "all",
        "--limit",
        "500",
        "--json",
        "number,title,state",
      ),
    );
const existingOf = (f) => issues.find((i) => i.title.includes(f.fingerprint));
const todo = targets.filter((f) => !existingOf(f));
const again = targets.filter((f) => existingOf(f));
process.stdout.write(
  `medium の未解決 ${targets.length} 件: 新規に起票 ${todo.length} 件 / 既存の Issue あり ${again.length} 件\n`,
);

const note = (f) =>
  `${new Date().toISOString().slice(0, 10)} の検査でも未解決（${f.tool} / ${f.rule_id} ${f.location}）。run: ${args["run-url"] ?? doc.run_url ?? "-"}`;
for (const f of again) {
  const issue = existingOf(f);
  process.stdout.write(`- 既存 #${issue.number}（${issue.state}）: ${f.rule_id}\n`);
  if (args["dry-run"]) continue;
  if (issue.state === "CLOSED")
    gh("issue", "reopen", String(issue.number), "--comment", `再検出: ${note(f)}`);
  else if (args["comment-existing"]) gh("issue", "comment", String(issue.number), "--body", note(f));
}

const bodyOf = (f) =>
  [
    `重大度 medium の検出が未解決。SLA は 90 日（security/README.md）。修正するか、security/accepted-risks.yaml に期限付きで受容する。`,
    "",
    `- ツール / ルール: ${f.tool} / ${f.rule_id}`,
    `- 場所: ${f.location}${f.component ? `（部品 ${f.component}）` : ""}`,
    `- 内容: ${f.title}`,
    `- 指紋: ${f.fingerprint}（findings.json で追跡）`,
    `- 初検出の run: ${doc.run_url ?? "-"}`,
  ].join("\n");

if (!args["dry-run"] && todo.length) {
  gh(
    "label",
    "create",
    "security",
    "--color",
    "b60205",
    "--description",
    "セキュリティ検査の検出",
    "--force",
  );
}
for (const f of todo) {
  const title = `[security] ${f.rule_id} ${f.component ?? f.location} (${f.fingerprint})`;
  process.stdout.write(`- 新規: ${title}\n`);
  if (!args["dry-run"]) gh("issue", "create", "--title", title, "--body", bodyOf(f), "--label", "security");
}
