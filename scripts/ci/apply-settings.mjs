#!/usr/bin/env node
// .github/settings/ のリポジトリ設定・Ruleset を gh api で適用する（冪等）。
//   node scripts/ci/apply-settings.mjs --dry-run     # 何も変更せず、現在の設定との差分だけを表示する（まずこれ）
//   node scripts/ci/apply-settings.mjs               # 差分のある項目だけを適用する
//   node scripts/ci/apply-settings.mjs --skip-rulesets   # Ruleset 以外だけ適用（Ruleset は最後に --only-rulesets で）
// 要: gh（リポジトリの管理者権限の認証）。通常は scripts/ci/apply-settings.sh から呼ぶ。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { formatDiff, labelDiff, rulesetDiff, subsetDiff } from "./lib/settings.mjs";

const dryRun = process.argv.includes("--dry-run");
// Ruleset は main への直接マージを止めるので、最後に別の手順で適用できるようにする（--skip-rulesets / --only-rulesets）
const skipRulesets = process.argv.includes("--skip-rulesets");
const onlyRulesets = process.argv.includes("--only-rulesets");
const dir = new URL("../../.github/settings/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const desired = read("repo-settings.json");
const out = (s) => process.stdout.write(`${s}\n`);

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}
function get(path) {
  try {
    return JSON.parse(gh(["api", path]) || "null");
  } catch {
    return null; // 404（未設定）や 204（本文なし）は「無い」として扱う
  }
}
const send = (method, path, body) =>
  body === undefined
    ? gh(["api", "-X", method, path])
    : gh(["api", "-X", method, path, "--input", "-"], JSON.stringify(body));
const repo = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
const r = (p) => (p ? `repos/${repo}/${p}` : `repos/${repo}`);

// 1 項目 = 現在の値の取得 + 差分 + 適用。差分が無ければ何もしない。
const simple = (title, path, want, apply) => ({ title, diffs: subsetDiff(want, get(r(path))), apply });

function repoTasks() {
  return [
    simple("リポジトリの基本設定（squash のみ・マージ後にブランチ削除など）", "", desired.repository, () =>
      send("PATCH", r(""), desired.repository),
    ),
    simple(
      "secret scanning・push protection・Dependabot security updates",
      "",
      { security_and_analysis: desired.security_and_analysis },
      () => send("PATCH", r(""), { security_and_analysis: desired.security_and_analysis }),
    ),
    simple(
      "private vulnerability reporting",
      "private-vulnerability-reporting",
      { enabled: desired.private_vulnerability_reporting },
      () => send("PUT", r("private-vulnerability-reporting")),
    ),
    simple(
      "Code Scanning の簡易設定（高度な設定と併用できない）",
      "code-scanning/default-setup",
      { state: desired.code_scanning.default_setup_state },
      () =>
        send("PATCH", r("code-scanning/default-setup"), { state: desired.code_scanning.default_setup_state }),
    ),
  ];
}

function actionTasks() {
  const a = desired.actions;
  return [
    simple("Actions の許可範囲・SHA 固定の強制", "actions/permissions", a.permissions, () =>
      send("PUT", r("actions/permissions"), a.permissions),
    ),
    simple("許可する action", "actions/permissions/selected-actions", a.selected_actions, () =>
      send("PUT", r("actions/permissions/selected-actions"), a.selected_actions),
    ),
    simple("workflow の既定権限（read）", "actions/permissions/workflow", a.workflow_permissions, () =>
      send("PUT", r("actions/permissions/workflow"), a.workflow_permissions),
    ),
    simple(
      "フォーク PR のワークフロー承認",
      "actions/permissions/fork-pr-contributor-approval",
      a.fork_pr_contributor_approval,
      () =>
        send("PUT", r("actions/permissions/fork-pr-contributor-approval"), a.fork_pr_contributor_approval),
    ),
  ];
}

function vulnerabilityAlerts() {
  const enabled = statusOk(r("vulnerability-alerts")); // 有効なら 204、無効なら 404
  return {
    title: "Dependabot alerts",
    diffs:
      enabled === desired.vulnerability_alerts
        ? []
        : [{ path: "vulnerability_alerts", from: enabled, to: desired.vulnerability_alerts }],
    apply: () => send("PUT", r("vulnerability-alerts")),
  };
}

function statusOk(path) {
  try {
    gh(["api", path]);
    return true;
  } catch {
    return false;
  }
}

function labels() {
  const plan = labelDiff(desired.labels, get(r("labels?per_page=100")) ?? []);
  const todo = plan.filter((p) => p.action !== "same");
  const apply = () =>
    todo.forEach((p) => {
      const l = desired.labels.find((x) => x.name === p.name);
      gh([
        "label",
        "create",
        l.name,
        "--color",
        l.color,
        "--description",
        l.description,
        "--force",
        "--repo",
        repo,
      ]);
    });
  return {
    title: "ラベル",
    diffs: todo.map((p) => ({
      path: `label.${p.name}`,
      from: p.action === "create" ? null : "差異あり",
      to: p.action,
    })),
    apply,
  };
}

function rulesets() {
  const current = get(r("rulesets")) ?? [];
  return ["ruleset-main.json", "ruleset-release-tags.json"].map((file) => {
    const want = read(file);
    const found = current.find((x) => x.name === want.name);
    const detail = found ? get(r(`rulesets/${found.id}`)) : null;
    const diffs = detail ? rulesetDiff(want, detail) : [{ path: want.name, from: null, to: "新規作成" }];
    const apply = () =>
      found ? send("PUT", r(`rulesets/${found.id}`), want) : send("POST", r("rulesets"), want);
    return { title: `Ruleset ${want.name}（${file}）`, diffs, apply };
  });
}

let pending = 0;
out(`対象: ${repo}（${dryRun ? "dry-run: 変更しない" : "適用する"}）`);
const settingTasks = () => [...repoTasks(), ...actionTasks(), vulnerabilityAlerts(), labels()];
for (const t of [...(onlyRulesets ? [] : settingTasks()), ...(skipRulesets ? [] : rulesets())]) {
  if (t.diffs.length === 0) {
    out(`= ${t.title}: 変更なし`);
    continue;
  }
  pending += 1;
  out(`~ ${t.title}: 差分 ${t.diffs.length} 件\n${formatDiff(t.diffs)}`);
  if (!dryRun) {
    t.apply();
    out("    → 適用した");
  }
}
out(
  `${pending} 項目に差分${dryRun ? "（dry-run のため未適用。適用するなら --dry-run を外す）" : "（適用済み）"}`,
);
