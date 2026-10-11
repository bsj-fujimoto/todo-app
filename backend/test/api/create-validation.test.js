// TC-030〜TC-036: POST /api/v1/tasks の入力検証。
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { readRows, seedTasks } from "../../test-support/db.js";
import { UUID_V4, assertError, assertSpecError, titlesOf } from "../helpers/assertions.js";
import { DEFAULT_NOW, createHarness } from "../helpers/harness.js";

const codePoints = (text) => [...text].length;

describe("POST /api/v1/tasks 入力検証", () => {
  const harness = createHarness();
  let dbPath;
  let api;

  async function startWith(seed) {
    ({ dbPath } = await harness.sandbox());
    if (seed) seedTasks(dbPath, seed);
    api = await harness.start({ dbPath });
  }
  afterEach(() => harness.cleanup());

  describe("空の DB（DS-001）から", () => {
    beforeEach(() => startWith(null));

    it("[TC-030] 100 文字（a×100・😀×100）は 201 で追加でき、Location は付かず、コードポイントで 100", async () => {
      const bodies = ["a".repeat(100), "😀".repeat(100)];
      for (const title of bodies) {
        const res = await api.post("/api/v1/tasks", { title });
        assert.equal(res.status, 201);
        assert.deepEqual(Object.keys(res.body).sort(), ["completed", "createdAt", "id", "title"]);
        assert.match(res.body.id, UUID_V4);
        assert.equal(res.body.title, title);
        assert.equal(res.body.completed, false);
        assert.equal(res.body.createdAt, DEFAULT_NOW);
        assert.equal(res.headers.get("location"), null);
      }
      const list = await api.get("/api/v1/tasks");
      assert.deepEqual(titlesOf(list), ["😀".repeat(100), "a".repeat(100)]);
      const rows = readRows(dbPath);
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map((row) => codePoints(row.title)),
        [100, 100],
      );
      assert.deepEqual(
        rows.map((row) => row.title.length),
        [100, 200],
      );
      const posts = api.completedLogs().filter((log) => log.method === "POST");
      assert.deepEqual(
        posts.map((log) => log.statusCode),
        [201, 201],
      );
    });

    it("[TC-032] 空・空白のみ・タブ・改行だけは 422 TITLE_REQUIRED で、何も保存されない", async () => {
      for (const title of ["", "   ", "\t", "\n"]) {
        assertSpecError(await api.post("/api/v1/tasks", { title }), 422, "TITLE_REQUIRED");
      }
      assert.deepEqual(readRows(dbPath), []);
      const logs = api.completedLogs().filter((log) => log.method === "POST");
      assert.deepEqual(
        logs.map((log) => log.statusCode),
        [422, 422, 422, 422],
      );
      assert.ok(logs.every((log) => log.level < 50));
    });

    it("[TC-033] 改行を含むと 422 TITLE_MULTILINE で、一覧は空のまま", async () => {
      for (const title of ["a\nb", "a\r\nb"]) {
        assertSpecError(await api.post("/api/v1/tasks", { title }), 422, "TITLE_MULTILINE");
      }
      const list = await api.get("/api/v1/tasks");
      assert.deepEqual(list.body, { tasks: [] });
      assert.deepEqual(readRows(dbPath), []);
    });

    it("[TC-034] 前後の空白は除去されて保存される（応答・一覧・title 列のすべて）", async () => {
      const created = await api.post("/api/v1/tasks", { title: "  買い物  " });
      assert.equal(created.status, 201);
      assert.equal(created.body.title, "買い物");
      const list = await api.get("/api/v1/tasks");
      assert.equal(list.body.tasks[0].title, "買い物");
      const rows = readRows(dbPath);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].title, "買い物");
    });

    it("[TC-035] 本文なし・{}・title が null/数値・配列は 400 INVALID_REQUEST（422 や 500 にならない）", async () => {
      const post = (options) => api.request("POST", "/api/v1/tasks", options);
      const responses = [
        await post({ headers: { "content-type": "application/json" } }),
        await post({ json: {} }),
        await post({ json: { title: null } }),
        await post({ json: { title: 123 } }),
        await post({ json: [] }),
      ];
      for (const res of responses) assertError(res, 400, "INVALID_REQUEST");
      assert.deepEqual(readRows(dbPath), []);
      const logs = api.completedLogs().filter((log) => log.method === "POST");
      assert.deepEqual(
        logs.map((log) => log.statusCode),
        [400, 400, 400, 400, 400],
      );
      assert.ok(logs.every((log) => log.level < 50));
    });

    it("[TC-036] 未知のフィールド・不正な JSON は 400 INVALID_REQUEST（無視せず拒否）で、一覧は空のまま", async () => {
      assertError(await api.post("/api/v1/tasks", { title: "a", extra: 1 }), 400, "INVALID_REQUEST");
      assertError(await api.request("POST", "/api/v1/tasks", { raw: '{"title":' }), 400, "INVALID_REQUEST");
      assert.deepEqual((await api.get("/api/v1/tasks")).body, { tasks: [] });
      assert.deepEqual(readRows(dbPath), []);
    });
  });

  describe("標準タスク 3 件（DS-002）から", () => {
    beforeEach(() => startWith(STANDARD_TASKS));

    it("[TC-031] 101 文字以上（巨大な 10 万文字を含む）は 422 TITLE_TOO_LONG で、backend は落ちず一覧も変わらない", async () => {
      const before = readRows(dbPath);
      for (const title of ["a".repeat(101), "😀".repeat(101), "a".repeat(100000)]) {
        assertSpecError(await api.post("/api/v1/tasks", { title }), 422, "TITLE_TOO_LONG");
      }
      const list = await api.get("/api/v1/tasks");
      assert.equal(list.body.tasks.length, 3);
      assert.deepEqual(readRows(dbPath), before);
    });
  });
});
