// TC-038, TC-039: 一覧の並び順（createdAt の降順。同時刻は保存順の新しいものが先）。seedTasks() で SQLite へ直接投入する。
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fixedClock, steppingClock } from "../../test-support/clock.js";
import { SAME_TIME_TASKS, STANDARD_TASKS } from "../../test-support/datasets.js";
import { readRows, seedTasks } from "../../test-support/db.js";
import { titlesOf } from "../helpers/assertions.js";
import { createHarness } from "../helpers/harness.js";

const [MILK, SPEC, PREP] = STANDARD_TASKS;

describe("GET /api/v1/tasks 並び順", () => {
  const harness = createHarness();
  afterEach(() => harness.cleanup());

  it("[TC-038] 挿入順ではなく createdAt の降順で返し、新規追加は先頭に来る", async () => {
    const { dbPath } = await harness.sandbox();
    // 挿入順が createdAt の順と異なる（09:00:02 → 09:00:00 → 09:00:01）
    seedTasks(dbPath, [PREP, MILK, SPEC]);
    const api = await harness.start({ dbPath, clock: fixedClock("2026-10-01T09:00:03.000Z") });

    assert.deepEqual(titlesOf(await api.get("/api/v1/tasks")), [PREP.title, SPEC.title, MILK.title]);

    const created = await api.post("/api/v1/tasks", { title: "新規タスク" });
    assert.equal(created.status, 201);
    assert.deepEqual(titlesOf(await api.get("/api/v1/tasks")), [
      "新規タスク",
      PREP.title,
      SPEC.title,
      MILK.title,
    ]);

    const rows = readRows(dbPath);
    assert.equal(rows.length, 4);
    const newest = rows.find((row) => row.title === "新規タスク");
    assert.ok(rows.filter((row) => row !== newest).every((row) => row.created_at < newest.created_at));
  });

  it("[TC-039] 同時刻のタスクは保存順の新しいものが先で、繰り返しても再起動しても同じ", async () => {
    const { dbPath } = await harness.sandbox();
    seedTasks(dbPath, SAME_TIME_TASKS);
    const expected = ["同時刻-C", "同時刻-B", "同時刻-A"];
    let api = await harness.start({ dbPath });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.deepEqual(titlesOf(await api.get("/api/v1/tasks")), expected);
    }

    await api.stop();
    api = await harness.start({ dbPath });
    assert.deepEqual(titlesOf(await api.get("/api/v1/tasks")), expected);

    const rows = readRows(dbPath);
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map((row) => row.created_at)).size, 1);
  });

  it("[補助] API で連続追加した順（時刻が進む）でも降順で返り、完了切替で並びは変わらない", async () => {
    const { dbPath } = await harness.sandbox();
    const api = await harness.start({ dbPath, clock: steppingClock("2026-10-01T09:00:00.000Z") });
    const first = await api.post("/api/v1/tasks", { title: "一つ目" });
    await api.post("/api/v1/tasks", { title: "二つ目" });
    await api.post("/api/v1/tasks", { title: "三つ目" });
    await api.patch(`/api/v1/tasks/${first.body.id}`, { completed: true });
    assert.deepEqual(titlesOf(await api.get("/api/v1/tasks")), ["三つ目", "二つ目", "一つ目"]);
  });
});
