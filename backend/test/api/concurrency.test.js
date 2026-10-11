// TC-064, TC-065: 並行リクエスト（Promise.all）。
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { steppingClock } from "../../test-support/clock.js";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { readRows, seedTasks } from "../../test-support/db.js";
import { assertError, titlesOf } from "../helpers/assertions.js";
import { createHarness, errorLogs } from "../helpers/harness.js";

const [MILK, SPEC, PREP] = STANDARD_TASKS;

describe("並行リクエスト", () => {
  const harness = createHarness();
  afterEach(() => harness.cleanup());

  it("[TC-064] 20 件の同時追加がすべて 201 で、id は互いに異なり、欠落・重複なく保存順どおりに並ぶ", async () => {
    const { dbPath } = await harness.sandbox();
    // 同時刻のタスクが混ざるよう、clock は 2 回呼ばれるごとにしか進まない
    const api = await harness.start({ dbPath, clock: steppingClock("2026-10-01T09:00:00.000Z", 1000, 2) });
    const titles = Array.from({ length: 20 }, (_, index) => `並行-${String(index + 1).padStart(2, "0")}`);

    const responses = await Promise.all(titles.map((title) => api.post("/api/v1/tasks", { title })));

    assert.deepEqual(
      responses.map((res) => res.status),
      Array(20).fill(201),
    );
    assert.equal(new Set(responses.map((res) => res.body.id)).size, 20);
    const list = await api.get("/api/v1/tasks");
    assert.equal(list.body.tasks.length, 20);
    assert.deepEqual(titlesOf(list).sort(), [...titles].sort());
    const keys = list.body.tasks.map((task) => task.createdAt);
    assert.deepEqual(keys, [...keys].sort().reverse(), "createdAt の降順");
    const rows = readRows(dbPath);
    const expectedOrder = [...rows]
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.seq - a.seq)
      .map((row) => row.id);
    assert.deepEqual(
      list.body.tasks.map((task) => task.id),
      expectedOrder,
      "同一時刻は保存順の新しい方が先",
    );
    assert.ok(new Set(keys).size < 20, "同時刻のタスクが含まれている（この検証の前提）");
    assert.equal(rows.length, 20);
    assert.equal(new Set(rows.map((row) => row.id)).size, 20);
    assert.deepEqual(errorLogs(api.logs()), []);
  });

  it("[TC-065] 同じ id への 10 件の同時削除は、204 がちょうど 1 件・404 が 9 件・500 なし", async () => {
    const { dbPath } = await harness.sandbox();
    seedTasks(dbPath, STANDARD_TASKS);
    const api = await harness.start({ dbPath });

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => api.delete(`/api/v1/tasks/${SPEC.id}`)),
    );

    assert.equal(responses.filter((res) => res.status === 204).length, 1);
    const notFound = responses.filter((res) => res.status === 404);
    assert.equal(notFound.length, 9);
    for (const res of notFound) assertError(res, 404, "TASK_NOT_FOUND");
    assert.equal(responses.filter((res) => res.status >= 500).length, 0);
    assert.deepEqual(titlesOf(await api.get("/api/v1/tasks")), [PREP.title, MILK.title]);
    const rows = readRows(dbPath);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.id !== SPEC.id));
    assert.deepEqual(errorLogs(api.logs()), []);
  });
});
