// gh CLI のラッパー（composition root。プロセス起動を行う）。alert.mjs が使う。--dry-run では実行せず、コマンドを表示する。
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const LABELS = {
  incident: ["B60205", "外形監視のアラート・障害"],
  drill: ["FBCA04", "通知試験（意図的な障害注入。自動で close）"],
  escalated: ["D93F0B", "ack が遅れてリマインドした"],
  "ack-overdue": ["B60205", "ack の目標時間を超過した"],
  ack: ["0E8A16", "メンテナが確認した"],
};

const ISSUE_FIELDS = "number,url,createdAt,state,assignees,labels";
const LIST_FIELDS = "number,title,labels,createdAt,assignees,comments,url";

function runner(dryRun) {
  return async (args) => {
    if (dryRun) {
      console.log(`[dry-run] gh ${args.join(" ")}`);
      return "";
    }
    return (await exec("gh", args)).stdout;
  };
}

async function createIssue(run, view, repo, spec) {
  const args = ["issue", "create", "--repo", repo, "--title", spec.title, "--body", spec.body];
  args.push("--assignee", spec.assignee);
  for (const l of spec.labels) args.push("--label", l);
  const url = (await run(args)).trim();
  return url
    ? view(url.split("/").pop())
    : { number: 0, url: "(dry-run)", createdAt: new Date().toISOString() };
}

async function ensureLabels(run, repo) {
  for (const [name, [color, description]] of Object.entries(LABELS)) {
    await run([
      "label",
      "create",
      name,
      "--repo",
      repo,
      "--color",
      color,
      "--description",
      description,
      "--force",
    ]);
  }
}

export function makeGh(repo, dryRun) {
  const run = runner(dryRun);
  const view = async (n) =>
    JSON.parse(await run(["issue", "view", String(n), "--repo", repo, "--json", ISSUE_FIELDS]));
  const issueCmd = (verb, n, ...rest) => run(["issue", verb, String(n), "--repo", repo, ...rest]);
  return {
    ensureLabels: () => ensureLabels(run, repo),
    listOpenIncidents: async () => {
      const out = await run([
        "issue",
        "list",
        "--repo",
        repo,
        "--label",
        "incident",
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        LIST_FIELDS,
      ]);
      return out ? JSON.parse(out) : [];
    },
    createIssue: (spec) => createIssue(run, view, repo, spec),
    comment: (n, body) => issueCmd("comment", n, "--body", body),
    close: (n) => issueCmd("close", n, "--reason", "completed"),
    addLabel: (n, label) => issueCmd("edit", n, "--add-label", label),
    viewIssue: view,
  };
}
