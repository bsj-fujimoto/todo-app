// consumer contract（利用側の期待の記録）: frontend の api-client が backend に頼っている呼び出しと応答の項目を、
// Pact のモックサーバーに対する実際の呼び出しとして記録し、frontend/contracts/frontend-backend.json に書き出す。
// 検証する側（provider）は backend/test/contract/consumer-contract.test.js。docs/06-api-test.md の api-11 を参照。
//
// 契約に入れるのは frontend が実際に頼るものだけ（過剰な契約にしない）:
//   - 呼ぶ operation（メソッド・パス・本文）と、期待するステータス
//   - 応答で使う項目: Task の id・title・completed（createdAt は画面で使わないので入れない）、失敗時の error.code
//   - error.message は使わない（文言は frontend の MESSAGES が持つ）ので入れない
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MatchersV3, PactV4 } from "@pact-foundation/pact";
import { createApiClient } from "../../src/api-client.js";

process.env.PACT_DO_NOT_TRACK ??= "true"; // 利用統計を送らない

const { boolean, eachLike, string, uuid } = MatchersV3;

export const CONTRACTS_DIR = fileURLToPath(new URL("../../contracts/", import.meta.url));
const PACT_FILE = `${CONTRACTS_DIR}frontend-backend.json`;

// provider state の名前は backend/test/contract/provider-states.js と一致させる
const STATES = {
  tasks: "tasks exist",
  empty: "no tasks exist",
  corrupt: "stored data is corrupt",
  unwritable: "the data store cannot be written",
};
const EXISTING_ID = "5f1b0c1e-1111-4a11-8a11-000000000001"; // STANDARD_TASKS（DS-002）の 1 件目
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const JSON_BODY = { "Content-Type": "application/json" };

const taskBody = (completed) => ({
  id: uuid(EXISTING_ID),
  title: string("牛乳を買う"),
  completed: boolean(completed),
});
const errorBody = (code) => ({ error: { code } });

function newPact() {
  return new PactV4({ consumer: "frontend", provider: "backend", dir: CONTRACTS_DIR, logLevel: "warn" });
}

/** 1 つの interaction を記録し、実際の api-client をモックサーバーに向けて呼ぶ。 */
async function record(pact, { state, description, request, response, run }) {
  const [method, path, requestSpec] = request;
  const [status, responseBody] = response;
  await pact
    .addInteraction()
    .given(state)
    .uponReceiving(description)
    .withRequest(method, path, (builder) => {
      if (requestSpec) builder.headers(JSON_BODY).jsonBody(requestSpec);
    })
    .willRespondWith(status, (builder) => {
      if (responseBody) builder.headers(JSON_BODY).jsonBody(responseBody);
    })
    .executeTest(async (mockServer) => {
      await run(createApiClient({ fetch, baseUrl: mockServer.url }));
    });
}

const failedWith = (status, code) => ({ ok: false, status, code });

describe("frontend の api-client が backend に頼る期待（consumer contract）", () => {
  const pact = newPact();

  before(() => {
    // 以前の記録が残って混ざらないよう、毎回ゼロから書き出す（生成物は frontend/contracts にコミットする）
    mkdirSync(CONTRACTS_DIR, { recursive: true });
    rmSync(PACT_FILE, { force: true });
  });

  it("[TC-037] 一覧: GET /api/v1/tasks が 200 で、各タスクの id・title・completed を持つ tasks 配列を返す", async () => {
    await record(pact, {
      state: STATES.tasks,
      description: "一覧を取得する",
      request: ["GET", "/api/v1/tasks"],
      response: [200, { tasks: eachLike(taskBody(false)) }],
      run: async (api) => {
        const result = await api.listTasks();
        assert.equal(result.ok, true);
        assert.deepEqual(Object.keys(result.data[0]).sort(), ["completed", "id", "title"]);
      },
    });
  });

  it("[TC-037] 一覧: タスクが無いときは 200 で空の tasks 配列", async () => {
    await record(pact, {
      state: STATES.empty,
      description: "タスクが 0 件のときの一覧を取得する",
      request: ["GET", "/api/v1/tasks"],
      response: [200, { tasks: [] }],
      run: async (api) => assert.deepEqual(await api.listTasks(), { ok: true, data: [] }),
    });
  });

  it("[TC-037] 一覧: 保存データが壊れているときは 500 の error.code が DATA_CORRUPT", async () => {
    await record(pact, {
      state: STATES.corrupt,
      description: "保存データが壊れているときの一覧を取得する",
      request: ["GET", "/api/v1/tasks"],
      response: [500, errorBody("DATA_CORRUPT")],
      run: async (api) => assert.deepEqual(await api.listTasks(), failedWith(500, "DATA_CORRUPT")),
    });
  });

  it("[TC-037] 追加: POST /api/v1/tasks に {title} を送ると 201 で id・title・completed を返す", async () => {
    await record(pact, {
      state: STATES.empty,
      description: "タスクを追加する",
      request: ["POST", "/api/v1/tasks", { title: "牛乳を買う" }],
      response: [201, taskBody(false)],
      run: async (api) => {
        const result = await api.createTask("牛乳を買う");
        assert.equal(result.ok, true);
        assert.equal(result.data.completed, false);
      },
    });
  });

  for (const [code, title] of [
    ["TITLE_REQUIRED", ""],
    ["TITLE_TOO_LONG", "a".repeat(101)],
    ["TITLE_MULTILINE", "a\nb"],
  ]) {
    it(`[TC-037] 追加: タイトルの違反は 422 の error.code が ${code}`, async () => {
      await record(pact, {
        state: STATES.empty,
        description: `タイトルが規則に違反している（${code}）`,
        request: ["POST", "/api/v1/tasks", { title }],
        response: [422, errorBody(code)],
        run: async (api) => assert.deepEqual(await api.createTask(title), failedWith(422, code)),
      });
    });
  }

  it("[TC-037] 追加: 保存に失敗したときは 503 の error.code が STORAGE_FAILURE", async () => {
    await record(pact, {
      state: STATES.unwritable,
      description: "保存できないときにタスクを追加する",
      request: ["POST", "/api/v1/tasks", { title: "牛乳を買う" }],
      response: [503, errorBody("STORAGE_FAILURE")],
      run: async (api) =>
        assert.deepEqual(await api.createTask("牛乳を買う"), failedWith(503, "STORAGE_FAILURE")),
    });
  });

  it("[TC-037] 完了切替: PATCH /api/v1/tasks/{id} に {completed} を送ると 200 で更新後の id・title・completed", async () => {
    await record(pact, {
      state: STATES.tasks,
      description: "完了状態を切り替える",
      request: ["PATCH", `/api/v1/tasks/${EXISTING_ID}`, { completed: true }],
      response: [200, taskBody(true)],
      run: async (api) => {
        const result = await api.updateTask(EXISTING_ID, true);
        assert.equal(result.ok, true);
        assert.equal(result.data.completed, true);
      },
    });
  });

  it("[TC-037] 完了切替: 存在しない id は 404 の error.code が TASK_NOT_FOUND", async () => {
    await record(pact, {
      state: STATES.empty,
      description: "存在しないタスクの完了状態を切り替える",
      request: ["PATCH", `/api/v1/tasks/${MISSING_ID}`, { completed: true }],
      response: [404, errorBody("TASK_NOT_FOUND")],
      run: async (api) =>
        assert.deepEqual(await api.updateTask(MISSING_ID, true), failedWith(404, "TASK_NOT_FOUND")),
    });
  });

  it("[TC-037] 完了切替: 保存に失敗したときは 503 の error.code が STORAGE_FAILURE", async () => {
    await record(pact, {
      state: STATES.unwritable,
      description: "保存できないときに完了状態を切り替える",
      request: ["PATCH", `/api/v1/tasks/${EXISTING_ID}`, { completed: true }],
      response: [503, errorBody("STORAGE_FAILURE")],
      run: async (api) =>
        assert.deepEqual(await api.updateTask(EXISTING_ID, true), failedWith(503, "STORAGE_FAILURE")),
    });
  });

  it("[TC-037] 削除: DELETE /api/v1/tasks/{id} は 204（本文なし）", async () => {
    await record(pact, {
      state: STATES.tasks,
      description: "タスクを削除する",
      request: ["DELETE", `/api/v1/tasks/${EXISTING_ID}`],
      response: [204],
      run: async (api) => assert.deepEqual(await api.deleteTask(EXISTING_ID), { ok: true, data: null }),
    });
  });

  it("[TC-037] 削除: 存在しない id は 404 の error.code が TASK_NOT_FOUND", async () => {
    await record(pact, {
      state: STATES.empty,
      description: "存在しないタスクを削除する",
      request: ["DELETE", `/api/v1/tasks/${MISSING_ID}`],
      response: [404, errorBody("TASK_NOT_FOUND")],
      run: async (api) =>
        assert.deepEqual(await api.deleteTask(MISSING_ID), failedWith(404, "TASK_NOT_FOUND")),
    });
  });

  it("[TC-037] 削除: 保存に失敗したときは 503 の error.code が STORAGE_FAILURE", async () => {
    await record(pact, {
      state: STATES.unwritable,
      description: "保存できないときにタスクを削除する",
      request: ["DELETE", `/api/v1/tasks/${EXISTING_ID}`],
      response: [503, errorBody("STORAGE_FAILURE")],
      run: async (api) =>
        assert.deepEqual(await api.deleteTask(EXISTING_ID), failedWith(503, "STORAGE_FAILURE")),
    });
  });
});
