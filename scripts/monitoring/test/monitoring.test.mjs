// 外形監視ロジックの単体テスト（node --test scripts/monitoring/test）。通信は偽の fetch、時刻は注入。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "yaml";
import {
  decideActions,
  defaultOwner,
  indexOpenIssues,
  isAcked,
  issueTitle,
  parseTitle,
} from "../lib/alert-core.mjs";
import { evaluateAll } from "../lib/checks.mjs";
import { checkConfig } from "../lib/config-check.mjs";
import { runApiAttempt, runHttpAttempt } from "../lib/exec-http.mjs";
import { runWithRetries } from "../lib/retry.mjs";
import { validateNamed } from "../lib/schema.mjs";
import { evaluateSuppression } from "../lib/suppress.mjs";
import { interpolate, jsonPath } from "../lib/vars.mjs";

const openapi = parse(readFileSync("backend/openapi.yaml", "utf8"));
const monitorsDoc = parse(readFileSync("monitoring/monitors.yaml", "utf8"));
const UUID = "123e4567-e89b-42d3-a456-426614174000";

// 契約どおりの API を in-memory で返す偽の fetch
function fakeApi({ breakDelete = false } = {}) {
  const tasks = [];
  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn = async (url, init) => {
    const path = new URL(url).pathname;
    const id = path.split("/")[4];
    if (path === "/api/v1/tasks" && init.method === "GET") return json(200, { tasks: [...tasks].reverse() });
    if (path === "/api/v1/tasks" && init.method === "POST") {
      const task = {
        id: UUID.replace(/0$/, String(tasks.length)),
        title: JSON.parse(init.body).title,
        completed: false,
        createdAt: "2026-10-11T00:00:00.000Z",
      };
      tasks.push(task);
      return json(201, task);
    }
    if (init.method === "DELETE") {
      const i = tasks.findIndex((t) => t.id === id);
      if (i < 0) return json(404, { error: { code: "TASK_NOT_FOUND", message: "x" } });
      if (!breakDelete) tasks.splice(i, 1);
      return new Response(null, { status: 204 });
    }
    return json(500, { error: { code: "INTERNAL_ERROR", message: "x" } });
  };
  return { fetchFn, tasks };
}

const deps = (fetchFn) => ({ fetchFn, now: () => 0, sleep: async () => {} });
const ctx = { baseUrl: "http://x", openapi, vars: { synthetic_title: "synthetic-t", BASE_URL: "http://x" } };
const find = (id) => ({ ...monitorsDoc.defaults, ...monitorsDoc.monitors.find((m) => m.monitor_id === id) });

describe("vars / jsonPath", () => {
  it("${name} を展開し、全体が変数 1 つなら型を保つ", () => {
    assert.equal(interpolate("a-${x}", { x: 1 }), "a-1");
    assert.equal(interpolate("${x}", { x: 3 }), 3);
    assert.equal(interpolate("${y}", { x: 3 }), "${y}", "未定義は残す");
  });

  it("jsonPath は入れ子・配列・length を読む", () => {
    const doc = { a: { b: [{ c: 1 }] }, list: [1, 2] };
    assert.equal(jsonPath(doc, "$.a.b[0].c"), 1);
    assert.equal(jsonPath(doc, "$.list.length"), 2);
    assert.equal(jsonPath(doc, "$.none.x"), undefined);
  });
});

describe("schema（openapi.yaml の契約）", () => {
  const task = { id: UUID, title: "a", completed: false, createdAt: "2026-10-11T00:00:00.000Z" };
  it("契約どおりの Task は通る", () => assert.deepEqual(validateNamed("Task", task, openapi), []));
  it("余計なフィールド・型違い・UUID でない id を検出する", () => {
    assert.ok(validateNamed("Task", { ...task, extra: 1 }, openapi).length > 0);
    assert.ok(validateNamed("Task", { ...task, completed: "no" }, openapi).length > 0);
    assert.ok(validateNamed("Task", { ...task, id: "abc" }, openapi).length > 0);
  });
  it("Health の db が enum 外なら失敗", () => {
    const h = { status: "ok", version: "1", commit: "abc", db: "ok" };
    assert.deepEqual(validateNamed("Health", h, openapi), []);
    assert.ok(validateNamed("Health", { ...h, db: "maybe" }, openapi).length > 0);
  });
});

describe("checks", () => {
  const res = {
    status: 200,
    headers: { "content-security-policy": "default-src 'self'" },
    bodyText: "<h1>My TODO</h1>",
    json: undefined,
    durationMs: 50,
  };
  it("status・本文・ヘッダ・応答時間を確かめる", () => {
    const ok = [
      { status: 200 },
      { body_contains: "My TODO" },
      { header: { name: "Content-Security-Policy", present: true } },
      { latency_ms_max: 100 },
    ];
    assert.deepEqual(evaluateAll(ok, res, { vars: {}, openapi }), []);
    const ng = evaluateAll([{ status: 201 }, { body_contains: "ZZZ" }, { latency_ms_max: 10 }], res, {
      vars: {},
      openapi,
    });
    assert.equal(ng.length, 3);
  });
  it("when_set は期待値が空なら検査しない（デプロイマーカーが未指定のとき）", () => {
    const r = { ...res, json: { version: "1.0.0" } };
    assert.deepEqual(
      evaluateAll([{ json: { path: "$.version", equals: "${expected_version}", when_set: true } }], r, {
        vars: { expected_version: "" },
        openapi,
      }),
      [],
    );
    assert.equal(
      evaluateAll([{ json: { path: "$.version", equals: "${expected_version}", when_set: true } }], r, {
        vars: { expected_version: "2.0.0" },
        openapi,
      }).length,
      1,
    );
  });
});

describe("api ジャーニー", () => {
  it("MON-003: 追加して一覧に残り、後始末で削除される", async () => {
    const api = fakeApi();
    const r = await runApiAttempt(find("MON-003"), deps(api.fetchFn), ctx);
    assert.equal(r.ok, true, r.failure);
    assert.equal(api.tasks.length, 0, "作ったタスクが残っていない");
  });

  it("MON-005: 削除が効かない実装を検知し、後始末でも失敗を報告する", async () => {
    const api = fakeApi({ breakDelete: true });
    const r = await runApiAttempt(find("MON-005"), deps(api.fetchFn), ctx);
    assert.equal(r.ok, false);
    assert.match(r.failure, /残っている|削除/);
  });

  it("通信エラーは失敗詳細に出る", async () => {
    const r = await runHttpAttempt(
      find("MON-002"),
      deps(async () => {
        throw new Error("ECONNREFUSED");
      }),
      { ...ctx, vars: { ...ctx.vars, expected_version: "", expected_commit: "" } },
    );
    assert.equal(r.ok, false);
    assert.match(r.failure, /ECONNREFUSED/);
  });
});

describe("retry", () => {
  it("retries: 2 なら最大 3 回試し、成功したら止める", async () => {
    let n = 0;
    const out = await runWithRetries(
      async () => ({ ok: ++n === 2, failure: "ng" }),
      { retries: 2, delayMs: 0 },
      { sleep: async () => {} },
    );
    assert.equal(out.ok, true);
    assert.equal(out.attempts, 2);
    const never = await runWithRetries(
      async () => ({ ok: false, failure: "ng" }),
      { retries: 2, delayMs: 0 },
      { sleep: async () => {} },
    );
    assert.equal(never.attempts, 3);
  });
});

describe("suppress（メンテナンス窓・リリース直後）", () => {
  const maintenance = {
    maintenance_windows: [
      { id: "MW", from: "2026-10-20T01:00:00Z", to: "2026-10-20T01:30:00Z", monitor_ids: [] },
    ],
    suppression_rules: [{ id: "SUP-001", kind: "after_release", minutes: 15, monitor_ids: [] }],
  };
  const at = (s) => Date.parse(s);
  it("計画停止の窓の中は抑制する", () => {
    assert.equal(
      evaluateSuppression({
        monitorId: "MON-001",
        nowMs: at("2026-10-20T01:10:00Z"),
        maintenance,
        markers: [],
      }).rule_id,
      "MW",
    );
    assert.equal(
      evaluateSuppression({
        monitorId: "MON-001",
        nowMs: at("2026-10-20T02:00:00Z"),
        maintenance,
        markers: [],
      }),
      null,
    );
  });
  it("リリース直後 15 分は抑制し、過ぎたら抑制しない", () => {
    const markers = [{ release_published_at: "2026-10-11T00:00:00Z" }];
    assert.equal(
      evaluateSuppression({ monitorId: "MON-002", nowMs: at("2026-10-11T00:10:00Z"), maintenance, markers })
        .rule_id,
      "SUP-001",
    );
    assert.equal(
      evaluateSuppression({ monitorId: "MON-002", nowMs: at("2026-10-11T00:16:00Z"), maintenance, markers }),
      null,
    );
  });
});

describe("alert-core", () => {
  const issue = {
    number: 7,
    title: "[sev1][MON-002] x が失敗",
    labels: [{ name: "incident" }],
    comments: [],
    createdAt: "2026-10-11T00:00:00Z",
  };
  it("CODEOWNERS の既定の所有者を on-call の実体にする", () => {
    assert.equal(defaultOwner("# c\n*   @bsj-fujimoto\n/docs/ @x\n"), "bsj-fujimoto");
  });
  it("失敗→作成、継続→コメント、回復→close、抑制→通知しない", () => {
    const open = indexOpenIssues([issue], false);
    const r = (id, result, extra) => ({ monitor_id: id, result, ...extra });
    const kinds = decideActions(
      [
        r("MON-002", "fail"),
        r("MON-001", "fail"),
        r("MON-003", "ok"),
        r("MON-005", "fail", { alert_suppressed: true }),
      ],
      open,
    ).map((a) => a.kind);
    assert.deepEqual(kinds, ["comment", "create", "suppressed"]);
    assert.deepEqual(
      decideActions([r("MON-002", "ok")], open).map((a) => a.kind),
      ["recover"],
    );
  });
  it("drill の Issue は本番の incident と混ざらない", () => {
    const drillIssue = {
      ...issue,
      title: issueTitle({ severity: "sev1", monitor_id: "MON-002", name: "x" }, true),
    };
    assert.equal(parseTitle(drillIssue.title).drill, true);
    assert.equal(indexOpenIssues([drillIssue], false).size, 0);
    assert.equal(indexOpenIssues([drillIssue], true).size, 1);
  });
  it("自動投稿者以外のコメントか ack ラベルで ack 済み", () => {
    assert.equal(isAcked(issue, ["github-actions"]), false);
    assert.equal(
      isAcked({ ...issue, comments: [{ author: { login: "github-actions" } }] }, ["github-actions"]),
      false,
    );
    assert.equal(
      isAcked({ ...issue, comments: [{ author: { login: "bsj-fujimoto" } }] }, ["github-actions"]),
      true,
    );
    assert.equal(isAcked({ ...issue, labels: [{ name: "ack" }] }, []), true);
  });
});

describe("config-check（設定の整合）", () => {
  const read = (p) => readFileSync(p, "utf8");
  const base = () => ({
    monitorsDoc: parse(read("monitoring/monitors.yaml")),
    routes: parse(read("monitoring/alert-routes.yaml")),
    runbooksDoc: parse(read("monitoring/runbooks/index.yaml")),
    slo: parse(read("perf/slo.yaml")),
    journeys: ["J-01", "J-02", "J-03", "J-04", "J-05"],
    read: (p) => read(p),
  });
  it("リポジトリの設定は整合している", () => assert.deepEqual(checkConfig(base()), []));
  it("slo_ref が slo.yaml に無い・通知経路が無い・ジャーニーが守られていない・runbook の節が欠ける、を検出する", () => {
    const c = base();
    c.monitorsDoc.monitors[0].slo_ref = "no_such_slo";
    c.routes.routes = c.routes.routes.slice(1);
    c.monitorsDoc.monitors = c.monitorsDoc.monitors.filter((m) => m.journey_id !== "J-05");
    c.read = () => "## 一次対応\n## 訓練記録\n";
    const problems = checkConfig(c).join("\n");
    assert.match(problems, /no_such_slo/);
    assert.match(problems, /通知経路/);
    assert.match(problems, /J-05/);
    assert.match(problems, /切り分け/);
  });
});
