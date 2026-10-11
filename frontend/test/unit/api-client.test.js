// api-client: 契約（backend/openapi.yaml）どおりの呼び出しと、失敗応答の正規化。fetch は注入した偽物を使う。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../../src/api-client.js";
import { TASK } from "./dom.js";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(respond) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { api: createApiClient({ fetch }), calls };
}

describe("createApiClient", () => {
  it("listTasks: GET /api/v1/tasks の tasks を返す", async () => {
    const { api, calls } = setup(() => json(200, { tasks: [TASK] }));
    assert.deepEqual(await api.listTasks(), { ok: true, data: [TASK] });
    assert.equal(calls[0].url, "/api/v1/tasks");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.body, undefined);
  });

  it("listTasks: tasks が配列でない 200 は INVALID_RESPONSE", async () => {
    const { api } = setup(() => json(200, { tasks: "x" }));
    assert.deepEqual(await api.listTasks(), { ok: false, status: 200, code: "INVALID_RESPONSE" });
  });

  it("createTask: POST に {title} を JSON で送り、201 の本文を返す", async () => {
    const { api, calls } = setup(() => json(201, TASK));
    assert.deepEqual(await api.createTask("牛乳を買う"), { ok: true, data: TASK });
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["Content-Type"], "application/json");
    assert.equal(calls[0].init.body, JSON.stringify({ title: "牛乳を買う" }));
  });

  it("updateTask: PATCH /api/v1/tasks/{id} に {completed} を送る（id はエンコードする）", async () => {
    const { api, calls } = setup(() => json(200, { ...TASK, completed: true }));
    const result = await api.updateTask("a/b", true);
    assert.equal(result.ok, true);
    assert.equal(calls[0].url, "/api/v1/tasks/a%2Fb");
    assert.equal(calls[0].init.method, "PATCH");
    assert.equal(calls[0].init.body, JSON.stringify({ completed: true }));
  });

  it("deleteTask: 204 は成功（本文なし）", async () => {
    const { api, calls } = setup(() => new Response(null, { status: 204 }));
    assert.deepEqual(await api.deleteTask(TASK.id), { ok: true, data: null });
    assert.equal(calls[0].init.method, "DELETE");
  });

  it("baseUrl を前置できる", async () => {
    const calls = [];
    const api = createApiClient({
      baseUrl: "http://example.test",
      fetch: async (url) => {
        calls.push(url);
        return json(200, { tasks: [] });
      },
    });
    await api.listTasks();
    assert.equal(calls[0], "http://example.test/api/v1/tasks");
  });

  for (const [status, code] of [
    [422, "TITLE_TOO_LONG"],
    [400, "INVALID_REQUEST"],
    [404, "TASK_NOT_FOUND"],
    [500, "DATA_CORRUPT"],
    [503, "STORAGE_FAILURE"],
  ]) {
    it(`${status} ${code} のエラー本文からコードを取り出す`, async () => {
      const { api } = setup(() => json(status, { error: { code, message: "x" } }));
      assert.deepEqual(await api.createTask("a"), { ok: false, status, code });
    });
  }

  it("JSON でない応答（nginx の 502 など）は UNKNOWN", async () => {
    const { api } = setup(() => new Response("<html>Bad Gateway</html>", { status: 502 }));
    assert.deepEqual(await api.createTask("a"), { ok: false, status: 502, code: "UNKNOWN" });
  });

  it("本文が壊れた 2xx は INVALID_RESPONSE", async () => {
    const { api } = setup(() => new Response("not json", { status: 201 }));
    assert.deepEqual(await api.createTask("a"), { ok: false, status: 201, code: "INVALID_RESPONSE" });
  });

  it("通信失敗（fetch が例外）は status 0 の NETWORK_ERROR。例外は投げない", async () => {
    const { api } = setup(() => {
      throw new TypeError("Failed to fetch");
    });
    assert.deepEqual(await api.deleteTask(TASK.id), { ok: false, status: 0, code: "NETWORK_ERROR" });
  });
});
