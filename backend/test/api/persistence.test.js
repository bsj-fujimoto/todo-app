// TC-042: backend プロセスを止めて同じ DB ファイルで起動し直しても、データと並びが保たれる（AC-06 の API 側）。
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { readRows, seedTasks } from "../../test-support/db.js";
import { spawnBackend } from "../../test-support/process.js";
import { createSandbox } from "../../test-support/sandbox.js";
import { createClient } from "../helpers/harness.js";

const RESTART_BUDGET_MS = 10_000;
const [MILK] = STANDARD_TASKS;

describe("再起動後の永続性（実プロセス）", () => {
  const cleanups = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups.length = 0;
  });

  it("[TC-042] 追加・完了切替の結果が再起動の前後で完全に一致し、起動は 10 秒以内でエラーログなし", async () => {
    const sandbox = await createSandbox();
    cleanups.push(() => sandbox.cleanup());
    seedTasks(sandbox.dbPath, STANDARD_TASKS);

    const first = await spawnBackend({ dbPath: sandbox.dbPath });
    cleanups.push(() => first.stop());
    const firstClient = createClient(first.url);
    assert.equal((await firstClient.post("/api/v1/tasks", { title: "資料を印刷する" })).status, 201);
    assert.equal((await firstClient.patch(`/api/v1/tasks/${MILK.id}`, { completed: true })).status, 200);
    const recorded = await firstClient.get("/api/v1/tasks");
    assert.equal(recorded.status, 200);
    assert.equal(recorded.body.tasks.length, 4);
    const exit = await first.stop("SIGTERM");
    assert.equal(exit.code, 0, "SIGTERM で正常終了する");

    const startedAt = performance.now();
    const second = await spawnBackend({ dbPath: sandbox.dbPath });
    cleanups.push(() => second.stop());
    const after = await createClient(second.url).get("/api/v1/tasks");
    const elapsed = performance.now() - startedAt;

    assert.equal(after.status, 200);
    assert.deepEqual(after.body, recorded.body);
    assert.ok(elapsed <= RESTART_BUDGET_MS, `再起動から GET 200 まで ${Math.round(elapsed)}ms`);
    const rows = readRows(sandbox.dbPath);
    assert.equal(rows.length, 4);
    assert.equal(rows.find((row) => row.id === MILK.id).completed, 1);
    assert.equal(rows.find((row) => row.title === "資料を印刷する").completed, 0);
    assert.deepEqual(
      second.logs().filter((line) => line.level >= 50),
      [],
    );
  });
});
