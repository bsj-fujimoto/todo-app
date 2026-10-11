// scripts/ci/lib/settings.mjs の単体テスト（リポジトリ設定の差分計算）。実行: node --test "scripts/test/*.test.mjs"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { labelDiff, normalizeRuleset, rulesetDiff, subsetDiff } from "../ci/lib/settings.mjs";

const json = (p) => JSON.parse(readFileSync(new URL(`../../.github/settings/${p}`, import.meta.url), "utf8"));

describe("subsetDiff（望む項目だけを比べる）", () => {
  it("書いていない項目・_ で始まる説明は差分にしない。配列は順序を問わない", () => {
    const current = { a: 1, b: { c: "x", extra: true }, list: ["y", "x"] };
    assert.deepEqual(subsetDiff({ _comment: "説明", a: 1, b: { c: "x" }, list: ["x", "y"] }, current), []);
    assert.deepEqual(
      subsetDiff({ a: 2, b: { c: "z" } }, current).map((d) => d.path),
      ["a", "b.c"],
    );
    assert.deepEqual(subsetDiff({ missing: true }, current), [{ path: "missing", from: null, to: true }]);
  });
});

describe("ruleset-main.json（main の統制の中身）", () => {
  const main = json("ruleset-main.json");
  const param = (type) => main.rules.find((r) => r.type === type)?.parameters;

  it("PR 必須（承認 1・code owner・stale dismiss）、required checks は ci-result と security-result、force push・削除禁止、linear history", () => {
    assert.equal(main.enforcement, "active");
    assert.deepEqual(main.conditions.ref_name.include, ["refs/heads/main"]);
    assert.equal(param("pull_request").required_approving_review_count, 1);
    assert.equal(param("pull_request").require_code_owner_review, true);
    assert.equal(param("pull_request").dismiss_stale_reviews_on_push, true);
    assert.equal(param("pull_request").require_last_push_approval, false);
    assert.deepEqual(
      param("required_status_checks")
        .required_status_checks.map((c) => c.context)
        .sort(),
      ["ci-result", "security-result"],
    );
    assert.equal(param("required_status_checks").strict_required_status_checks_policy, true);
    const types = main.rules.map((r) => r.type);
    for (const t of ["non_fast_forward", "deletion", "required_linear_history"])
      assert.ok(types.includes(t), t);
  });

  it("bypass はリポジトリ管理者の pull_request モードだけ", () => {
    assert.deepEqual(main.bypass_actors, [
      { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" },
    ]);
  });

  it("GitHub が返す形（id・source・既定値つき）と同じ内容なら差分なし、ルールが欠ければ検出する", () => {
    const live = {
      ...main,
      id: 1,
      source: "bsj-fujimoto/todo-app",
      rules: main.rules.map((r) => ({
        ...r,
        parameters: r.parameters && { ...r.parameters, extra_default: false },
      })),
    };
    assert.deepEqual(rulesetDiff(main, live), []);
    const weaker = { ...live, rules: live.rules.filter((r) => r.type !== "non_fast_forward") };
    assert.deepEqual(
      rulesetDiff(main, weaker).map((d) => d.path),
      ["rules.non_fast_forward"],
    );
    const lax = structuredClone(live);
    lax.rules.find((r) => r.type === "pull_request").parameters.required_approving_review_count = 0;
    assert.deepEqual(
      rulesetDiff(main, lax).map((d) => d.path),
      ["rules.pull_request.required_approving_review_count"],
    );
    assert.equal(normalizeRuleset(live).rules[0].type, "deletion");
  });
});

describe("repo-settings.json・labelDiff", () => {
  it("squash のみ・マージ後ブランチ削除・secret scanning と push protection・SHA 固定の強制を要求している", () => {
    const s = json("repo-settings.json");
    assert.equal(s.repository.allow_squash_merge, true);
    assert.equal(s.repository.allow_merge_commit, false);
    assert.equal(s.repository.delete_branch_on_merge, true);
    assert.equal(s.security_and_analysis.secret_scanning.status, "enabled");
    assert.equal(s.security_and_analysis.secret_scanning_push_protection.status, "enabled");
    assert.equal(s.vulnerability_alerts, true);
    assert.equal(s.private_vulnerability_reporting, true);
    assert.equal(s.actions.permissions.sha_pinning_required, true);
    assert.equal(s.actions.workflow_permissions.default_workflow_permissions, "read");
  });

  it("ラベルの作成・更新・変更なしを判定する", () => {
    const plan = labelDiff(
      [
        { name: "a", color: "ffffff", description: "x" },
        { name: "b", color: "000000", description: "y" },
        { name: "c", color: "111111", description: "z" },
      ],
      [
        { name: "a", color: "FFFFFF", description: "x" },
        { name: "b", color: "000000", description: "別" },
      ],
    );
    assert.deepEqual(
      plan.map((p) => p.action),
      ["same", "update", "create"],
    );
  });
});
