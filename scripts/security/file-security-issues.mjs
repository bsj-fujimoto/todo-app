#!/usr/bin/env node
// medium の未解決の検出を Issue にする（ラベル security）。同じ指紋の open Issue があれば作らない。
//   node scripts/security/file-security-issues.mjs --findings security-findings/findings.json [--dry-run]
// 重大度ポリシー: medium は Issue 化して、90 日以内に修正するか、security/accepted-risks.yaml に期限付きで受容する。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "../ci/lib/args.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["dry-run"] });
const doc = JSON.parse(readFileSync(args.findings, "utf8"));
const gh = (...a) => execFileSync("gh", a, { encoding: "utf8" });

const targets = doc.findings.filter((f) => f.severity === "medium" && ["untriaged", "tp"].includes(f.status));
const open = args["dry-run"]
  ? []
  : JSON.parse(
      gh("issue", "list", "--label", "security", "--state", "open", "--limit", "300", "--json", "title"),
    ).map((i) => i.title);
const todo = targets.filter((f) => !open.some((t) => t.includes(f.fingerprint)));
process.stdout.write(`medium の未解決 ${targets.length} 件のうち、起票するもの ${todo.length} 件\n`);

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
  process.stdout.write(`- ${title}\n`);
  if (!args["dry-run"]) gh("issue", "create", "--title", title, "--body", bodyOf(f), "--label", "security");
}
