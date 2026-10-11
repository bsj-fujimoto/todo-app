// TC-009〜TC-012, TC-015: PATCH / DELETE の状態遷移（docs/03-test-spec.md §8.2 の API 側）。
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { readRows, seedTasks } from "../../test-support/db.js";
import { assertError, titlesOf, without } from "../helpers/assertions.js";
import { createHarness, errorLogs } from "../helpers/harness.js";

const [MILK, SPEC, PREP] = STANDARD_TASKS;
const UNREGISTERED_ID = "3f2b8c1e-7a4d-4e6b-9c2a-5d1e8f0a7b36";

describe("PATCH / DELETE /api/v1/tasks/:id", () => {
  const harness = createHarness();
  let dbPath;
  let api;

  beforeEach(async () => {
    ({ dbPath } = await harness.sandbox());
    seedTasks(dbPath, STANDARD_TASKS);
    api = await harness.start({ dbPath });
  });
  afterEach(() => harness.cleanup());

  it("[TC-009] 完了切替: 同値の再送もエラーにならず、title・createdAt は変わらず、並びも変わらない", async () => {
    const original = { id: MILK.id, title: MILK.title, createdAt: MILK.createdAt };
    const before = readRows(dbPath);
    const steps = [
      { send: false, expectedColumn: 0 },
      { send: true, expectedColumn: 1 },
      { send: true, expectedColumn: 1 },
      { send: false, expectedColumn: 0 },
    ];
    for (const step of steps) {
      const res = await api.patch(`/api/v1/tasks/${MILK.id}`, { completed: step.send });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ...original, completed: step.send });
      const row = readRows(dbPath).find((candidate) => candidate.id === MILK.id);
      assert.equal(row.completed, step.expectedColumn);
      assert.equal(row.title, MILK.title);
      assert.equal(row.created_at, MILK.createdAt);
      assert.deepEqual(without(readRows(dbPath), MILK.id), without(before, MILK.id));
    }
    assert.deepEqual(titlesOf(await api.get("/api/v1/tasks")), [PREP.title, SPEC.title, MILK.title]);
    const patches = api.completedLogs().filter((log) => log.method === "PATCH");
    assert.deepEqual(
      patches.map((log) => log.statusCode),
      [200, 200, 200, 200],
    );
  });

  it("[TC-010] 完了切替以外の変更・空本文・型違いは 400 INVALID_REQUEST で、何も変わらない", async () => {
    const before = readRows(dbPath);
    const bodies = [
      { completed: true, title: "x" },
      { createdAt: "2020-01-01T00:00:00.000Z" },
      { id: UNREGISTERED_ID },
      {},
      { completed: "yes" },
    ];
    for (const body of bodies) {
      assertError(await api.patch(`/api/v1/tasks/${MILK.id}`, body), 400, "INVALID_REQUEST");
    }
    const list = await api.get("/api/v1/tasks");
    const milk = list.body.tasks.find((task) => task.id === MILK.id);
    assert.deepEqual(milk, {
      id: MILK.id,
      title: "牛乳を買う",
      completed: false,
      createdAt: "2026-10-01T09:00:00.000Z",
    });
    assert.deepEqual(readRows(dbPath), before);
  });

  it("[TC-011] 形式が有効で未登録・削除済みの id は 404 TASK_NOT_FOUND（404 はサーバー障害ではない）", async () => {
    const before = readRows(dbPath);
    assertError(
      await api.patch(`/api/v1/tasks/${UNREGISTERED_ID}`, { completed: true }),
      404,
      "TASK_NOT_FOUND",
    );
    assertError(await api.delete(`/api/v1/tasks/${UNREGISTERED_ID}`), 404, "TASK_NOT_FOUND");

    const created = await api.post("/api/v1/tasks", { title: "あとで消す" });
    assert.equal(created.status, 201);
    const deleted = await api.delete(`/api/v1/tasks/${created.body.id}`);
    assert.equal(deleted.status, 204);

    assertError(
      await api.patch(`/api/v1/tasks/${created.body.id}`, { completed: true }),
      404,
      "TASK_NOT_FOUND",
    );
    assertError(await api.delete(`/api/v1/tasks/${created.body.id}`), 404, "TASK_NOT_FOUND");

    const list = await api.get("/api/v1/tasks");
    assert.deepEqual(titlesOf(list), [PREP.title, SPEC.title, MILK.title]);
    assert.deepEqual(readRows(dbPath), before);
    const notFound = api.completedLogs().filter((log) => log.statusCode === 404);
    assert.equal(notFound.length, 4);
    assert.ok(notFound.every((log) => log.level < 50));
    assert.deepEqual(errorLogs(api.logs()), []);
  });

  it("[TC-012] id が UUID の形式でなければ 404 ではなく 400 INVALID_REQUEST", async () => {
    const before = readRows(dbPath);
    assertError(await api.patch("/api/v1/tasks/abc", { completed: true }), 400, "INVALID_REQUEST");
    assertError(await api.delete("/api/v1/tasks/123"), 400, "INVALID_REQUEST");
    assertError(await api.delete(`/api/v1/tasks/${"a".repeat(200)}`), 400, "INVALID_REQUEST");
    assert.equal((await api.get("/api/v1/tasks")).body.tasks.length, 3);
    assert.deepEqual(readRows(dbPath), before);
  });

  it("[TC-015] 削除は 204（本文なし）で対象だけが消え、同じ id の再削除は 404", async () => {
    const before = readRows(dbPath);
    const deleted = await api.delete(`/api/v1/tasks/${SPEC.id}`);
    assert.equal(deleted.status, 204);
    assert.equal(deleted.text, "");

    assert.deepEqual(titlesOf(await api.get("/api/v1/tasks")), [PREP.title, MILK.title]);
    const rows = readRows(dbPath);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows, without(before, SPEC.id));

    assertError(await api.delete(`/api/v1/tasks/${SPEC.id}`), 404, "TASK_NOT_FOUND");
    const deletes = api.completedLogs().filter((log) => log.method === "DELETE");
    assert.deepEqual(
      deletes.map((log) => log.statusCode),
      [204, 404],
    );
  });
});
