// 契約との突き合わせ（pact-vs-openapi.js）自体の検査: 期待が openapi.yaml とずれたら問題として検出すること。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { checkPactAgainstOpenApi } from "../helpers/pact-vs-openapi.js";

const PACT_URL = new URL("../../../frontend/contracts/frontend-backend.json", import.meta.url);
const load = () => JSON.parse(readFileSync(PACT_URL, "utf8"));
const find = (pact, description) => pact.interactions.find((i) => i.description === description);

describe("consumer contract と openapi.yaml の突き合わせ（ずれの検出）", () => {
  it("[TC-037] 記録された期待は契約と整合している（問題 0 件）", () => {
    assert.deepEqual(checkPactAgainstOpenApi(load()), []);
  });

  it("[TC-037] 契約に宣言されていない operation（パス・メソッド）を呼ぶ期待を検出する", () => {
    const pact = load();
    find(pact, "一覧を取得する").request.path = "/api/v1/todos";
    find(pact, "タスクを削除する").request.method = "PUT";
    const problems = checkPactAgainstOpenApi(pact);
    assert.equal(problems.length, 2);
    assert.ok(problems.every((p) => p.includes("契約に宣言されていない operation")));
  });

  it("[TC-037] リクエスト本文が契約のスキーマに合わない（未知のフィールド・型違い）期待を検出する", () => {
    const pact = load();
    find(pact, "タスクを追加する").request.body.content = { title: "a", extra: 1 };
    find(pact, "完了状態を切り替える").request.body.content = { completed: "yes" };
    const problems = checkPactAgainstOpenApi(pact);
    assert.deepEqual(
      problems.map((p) => p.match(/契約の (\w+) に合わない/)?.[1]),
      ["CreateTaskRequest", "UpdateTaskRequest"],
    );
  });

  it("[TC-037] 契約に宣言されていないステータスを期待していれば検出する", () => {
    const pact = load();
    find(pact, "存在しないタスクを削除する").response.status = 410;
    assert.match(checkPactAgainstOpenApi(pact).join("\n"), /ステータス 410 が契約に宣言されていない/);
  });

  it("[TC-037] 応答で頼る項目が契約に無い・型が違う・error.code が列挙に無い期待を検出する", () => {
    const pact = load();
    const list = find(pact, "一覧を取得する").response.body.content.tasks[0];
    list.done = list.completed; // 契約に無い項目
    delete list.completed;
    find(pact, "タスクを追加する").response.body.content.completed = "no"; // 型違い
    find(pact, "存在しないタスクを削除する").response.body.content.error.code = "GONE"; // 列挙に無い
    const problems = checkPactAgainstOpenApi(pact).join("\n");
    assert.match(problems, /\.done: 契約に無い項目に頼っている/);
    assert.match(problems, /\.completed: 型が契約と違う（契約 boolean \/ 期待 string）/);
    assert.match(problems, /契約の列挙に無い値 "GONE"/);
  });

  it("[TC-037] 契約に本文の定義が無い応答（204）に本文を期待していれば検出する", () => {
    const pact = load();
    find(pact, "タスクを削除する").response.body = { content: { ok: true } };
    assert.match(
      checkPactAgainstOpenApi(pact).join("\n"),
      /契約に本文の定義が無い応答に、本文を期待している/,
    );
  });
});
