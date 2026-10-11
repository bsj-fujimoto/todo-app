// 入力の堅牢性と、想定外の障害の扱い（テストケース外の補助検査）。
import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, it } from "node:test";
import { BODY_LIMIT_BYTES, MAX_DRAIN_BYTES, buildApp } from "../../src/app.js";
import { AppError } from "../../src/errors.js";
import { fixedClock, sequentialIdGenerator } from "../../test-support/clock.js";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { readRows, seedTasks } from "../../test-support/db.js";
import { assertError, assertSpecError } from "../helpers/assertions.js";
import { DEFAULT_NOW, INFO, createHarness } from "../helpers/harness.js";

/**
 * 生の HTTP 交換（fetch は早期応答と書込みの競合を隠すため使わない）。ソケットエラーは握りつぶさず errors に残し、
 * 応答の受信前に起きれば reject する。body が undefined ならヘッダだけ送って本文は書かない。
 */
function exchange(baseUrl, { method = "POST", path = "/api/v1/tasks", headers = {}, body, agent }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const errors = [];
    const request = http.request(
      { host: url.hostname, port: url.port, path, method, headers, agent },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: JSON.parse(text),
            request,
            errors,
          }),
        );
      },
    );
    request.on("error", (error) => {
      errors.push(error);
      reject(error);
    });
    if (body === undefined) request.flushHeaders();
    else if (typeof body === "string") request.end(body);
    else body.pipe(request);
  });
}

const JSON_HEADERS = { "content-type": "application/json" };

function* chunksOf(totalBytes, chunkBytes = 64 * 1024) {
  for (let sent = 0; sent < totalBytes; sent += chunkBytes) yield Buffer.alloc(chunkBytes, 0x61);
}

describe("入力の堅牢性", () => {
  const harness = createHarness();
  afterEach(() => harness.cleanup());

  async function startSeeded() {
    const { dbPath } = await harness.sandbox();
    seedTasks(dbPath, STANDARD_TASKS);
    return { dbPath, api: await harness.start({ dbPath }) };
  }

  describe("本文サイズ超過（bodyLimit 1 MiB）", () => {
    const REPEAT = 20;
    const INVALID = { error: { code: "INVALID_REQUEST", message: "リクエストの形式が正しくありません" } };

    // 超過しても、応答が RST で失われず確実に届き、backend も DB も無事で、以後のリクエストが正常であること
    async function assertStillHealthy(api, dbPath, before) {
      assert.equal((await api.get("/api/v1/tasks")).status, 200);
      assert.deepEqual(readRows(dbPath), before);
    }

    it("[補助] fetch で 3 MiB の本文を送っても、400 INVALID_REQUEST を毎回確実に受け取れる", async () => {
      const { dbPath, api } = await startSeeded();
      const before = readRows(dbPath);
      const huge = JSON.stringify({ title: "a".repeat(3 * 1024 * 1024) });
      assert.ok(huge.length > BODY_LIMIT_BYTES);
      for (let attempt = 0; attempt < REPEAT; attempt += 1) {
        const res = await api.request("POST", "/api/v1/tasks", { raw: huge });
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, INVALID);
      }
      await assertStillHealthy(api, dbPath, before);
    });

    it("[補助] Connection: close のクライアント（Content-Length あり・3 MiB）でも応答を確実に受け取れる", async () => {
      const { dbPath, api } = await startSeeded();
      const before = readRows(dbPath);
      const body = JSON.stringify({ title: "a".repeat(3 * 1024 * 1024) });
      for (let attempt = 0; attempt < REPEAT; attempt += 1) {
        const res = await exchange(api.baseUrl, {
          headers: { ...JSON_HEADERS, "content-length": Buffer.byteLength(body) },
          body,
          agent: false,
        });
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, INVALID);
        assert.deepEqual(res.errors, []);
      }
      await assertStillHealthy(api, dbPath, before);
    });

    it("[補助] Content-Length なし（chunked）で上限超過（3 MiB）でも応答を確実に受け取れる", async () => {
      const { dbPath, api } = await startSeeded();
      const before = readRows(dbPath);
      for (let attempt = 0; attempt < REPEAT; attempt += 1) {
        const res = await exchange(api.baseUrl, {
          headers: { ...JSON_HEADERS, "transfer-encoding": "chunked" },
          body: Readable.from(chunksOf(3 * 1024 * 1024)),
        });
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, INVALID);
        assert.deepEqual(res.errors, []);
      }
      await assertStillHealthy(api, dbPath, before);
    });

    it("[補助] 宣言された Content-Length が読み捨て上限を超える場合は、本文を待たず 400 を返して接続を閉じる", async () => {
      const { dbPath, api } = await startSeeded();
      const before = readRows(dbPath);
      const headers = { ...JSON_HEADERS, "content-length": MAX_DRAIN_BYTES + 1 };
      const res = await exchange(api.baseUrl, { headers });
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, INVALID);
      assert.equal(res.headers.connection, "close");
      await assertStillHealthy(api, dbPath, before);
    });
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
