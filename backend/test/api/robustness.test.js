// 入力の堅牢性と、想定外の障害の扱い（テストケース外の補助検査）。
import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, describe, it } from "node:test";
import { BODY_LIMIT_BYTES, buildApp } from "../../src/app.js";
import { AppError } from "../../src/errors.js";
import { fixedClock, sequentialIdGenerator } from "../../test-support/clock.js";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { readRows, seedTasks } from "../../test-support/db.js";
import { assertError, assertSpecError } from "../helpers/assertions.js";
import { DEFAULT_NOW, INFO, createHarness } from "../helpers/harness.js";

/**
 * 本文サイズ超過では backend は応答してすぐ接続を閉じるため、fetch は書込み中のリセットで失敗しうる。
 * 応答が届いた時点で結果を返し、その後のソケットエラーは無視する。
 */
function postOversize(baseUrl, json) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/v1/tasks", baseUrl);
    const body = JSON.stringify(json);
    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
      },
    );
    request.on("error", (error) => {
      if (!request.res) reject(error);
    });
    request.end(body);
  });
}

describe("入力の堅牢性", () => {
  const harness = createHarness();
  afterEach(() => harness.cleanup());

  async function startSeeded() {
    const { dbPath } = await harness.sandbox();
    seedTasks(dbPath, STANDARD_TASKS);
    return { dbPath, api: await harness.start({ dbPath }) };
  }

  it("[補助] 数 MB の本文は bodyLimit で 400 INVALID_REQUEST になり、backend は落ちず DB も変わらない", async () => {
    const { dbPath, api } = await startSeeded();
    const before = readRows(dbPath);
    const huge = { title: "a".repeat(3 * 1024 * 1024) };
    assert.ok(JSON.stringify(huge).length > BODY_LIMIT_BYTES);

    const res = await postOversize(api.baseUrl, huge);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_REQUEST");

    assert.equal((await api.get("/api/v1/tasks")).status, 200);
    assert.deepEqual(readRows(dbPath), before);
  });

  it("[補助] 1 万文字のタイトルは 422 TITLE_TOO_LONG で返せる（bodyLimit に掛からない）", async () => {
    const { api } = await startSeeded();
    assertSpecError(await api.post("/api/v1/tasks", { title: "あ".repeat(10000) }), 422, "TITLE_TOO_LONG");
  });

  it("[補助] Content-Type 違い・本文なしの POST/PATCH は 400 INVALID_REQUEST", async () => {
    const { api } = await startSeeded();
    const text = { headers: { "content-type": "text/plain" }, raw: '{"title":"a"}' };
    assertError(await api.request("POST", "/api/v1/tasks", text), 400, "INVALID_REQUEST");
    const form = { headers: { "content-type": "application/x-www-form-urlencoded" }, raw: "title=a" };
    assertError(await api.request("POST", "/api/v1/tasks", form), 400, "INVALID_REQUEST");
    assertError(await api.request("POST", "/api/v1/tasks"), 400, "INVALID_REQUEST");
    const patch = { headers: { "content-type": "text/plain" }, raw: "completed=true" };
    assertError(
      await api.request("PATCH", `/api/v1/tasks/${STANDARD_TASKS[0].id}`, patch),
      400,
      "INVALID_REQUEST",
    );
  });

  it("[補助] 本文が JSON の null・文字列・数値、__proto__ を含むオブジェクトも 400 INVALID_REQUEST", async () => {
    const { api } = await startSeeded();
    for (const raw of ["null", '"title"', "123", '{"title":"a","__proto__":{"x":1}}', "{}{}", ""]) {
      assertError(await api.request("POST", "/api/v1/tasks", { raw }), 400, "INVALID_REQUEST");
    }
  });

  it("[補助] 契約にないパス・メソッドは 404 ROUTE_NOT_FOUND（エラー封筒で返る）", async () => {
    const { api } = await startSeeded();
    assertError(await api.get("/api/v1/nope"), 404, "ROUTE_NOT_FOUND");
    assertError(await api.request("PUT", "/api/v1/tasks", { json: {} }), 404, "ROUTE_NOT_FOUND");
    assertError(await api.get("/"), 404, "ROUTE_NOT_FOUND");
  });

  it("[補助] 末尾スラッシュ付きのパスも同じ operation として扱う", async () => {
    const { api } = await startSeeded();
    const res = await api.get("/api/v1/tasks/", { contract: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.tasks.length, 3);
  });
});

describe("想定外の障害", () => {
  const cleanups = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups.length = 0;
  });

  async function startWithStore(store) {
    const lines = [];
    const stream = { write: (chunk) => lines.push(JSON.parse(chunk)) };
    const app = buildApp({
      store,
      clock: fixedClock(DEFAULT_NOW),
      idGenerator: sequentialIdGenerator(),
      logger: { level: "info", stream },
      info: INFO,
    });
    cleanups.push(() => app.close());
    return { app, lines };
  }

  it("[補助] ストアが分類できない例外を投げたら 500 INTERNAL_ERROR で、error ログに errorCode が付く", async () => {
    const broken = new Error("boom");
    const store = {
      status: () => ({ ok: true }),
      listTasks: () => {
        throw broken;
      },
    };
    const { app, lines } = await startWithStore(store);

    const res = await app.inject({ method: "GET", url: "/api/v1/tasks" });

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.json(), {
      error: { code: "INTERNAL_ERROR", message: "サーバーでエラーが発生しました" },
    });
    const errors = lines.filter((line) => line.level >= 50);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].errorCode, "INTERNAL_ERROR");
  });

  it("[補助] ストアが投げた AppError（DATA_CORRUPT・STORAGE_FAILURE）は、コードどおりの status と文言で返る", async () => {
    const failures = [
      ["DATA_CORRUPT", 500],
      ["STORAGE_FAILURE", 503],
    ];
    for (const [code, status] of failures) {
      const store = {
        status: () => ({ ok: false, error: new AppError(code, { detail: "stub" }) }),
        createTask: () => {
          throw new AppError(code, { detail: "stub" });
        },
      };
      const { app, lines } = await startWithStore(store);
      const res = await app.inject({ method: "POST", url: "/api/v1/tasks", payload: { title: "a" } });
      assert.equal(res.statusCode, status);
      assert.equal(res.json().error.code, code);
      assert.ok(lines.some((line) => line.level >= 50 && line.errorCode === code && line.detail === "stub"));
    }
  });
});
