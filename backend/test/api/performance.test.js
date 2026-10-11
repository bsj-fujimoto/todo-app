// TC-073: 1,000 件（DS-006）での応答時間。しきい値は暫定（docs/07-performance.md の SLO・件数上限 UNK-002 の決定で更新する）。
// 時間の計測にだけ performance.now() を使う（待機や実時刻に依存した判定はしない）。
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { steppingClock } from "../../test-support/clock.js";
import { bulkTasks } from "../../test-support/datasets.js";
import { readRows, seedTasks } from "../../test-support/db.js";
import { createHarness, errorLogs } from "../helpers/harness.js";

const LIST_P95_MS = 500; // 暫定しきい値（一覧 20 回）
const CREATE_P95_MS = 300; // 暫定しきい値（追加 10 回）

function percentile95(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

async function timed(operation) {
  const startedAt = performance.now();
  const result = await operation();
  return { result, elapsed: performance.now() - startedAt };
}

describe("性能（DS-006: 1,000 件）", () => {
  const harness = createHarness();
  afterEach(() => harness.cleanup());

  it("[TC-073] 一覧 20 回・追加 10 回の 95 パーセンタイルが暫定しきい値以内で、件数と並びが正しい", async () => {
    const { dbPath } = await harness.sandbox();
    seedTasks(dbPath, bulkTasks(1000));
    const api = await harness.start({
      dbPath,
      contract: false,
      clock: steppingClock("2026-10-02T00:00:00.000Z", 1000),
    });

    const listTimes = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { result, elapsed } = await timed(() => api.get("/api/v1/tasks"));
      assert.equal(result.status, 200);
      assert.equal(result.body.tasks.length, 1000);
      assert.equal(result.body.tasks[0].title, "タスク-1000", "createdAt の降順");
      listTimes.push(elapsed);
    }
    const createTimes = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const { result, elapsed } = await timed(() => api.post("/api/v1/tasks", { title: "性能確認" }));
      assert.equal(result.status, 201);
      createTimes.push(elapsed);
    }

    const list = await api.get("/api/v1/tasks");
    assert.equal(list.body.tasks.length, 1010);
    assert.equal(list.body.tasks[0].title, "性能確認");
    assert.equal(readRows(dbPath).length, 1010);
    assert.deepEqual(errorLogs(api.logs()), []);
    assert.ok(percentile95(listTimes) <= LIST_P95_MS, `一覧 p95=${percentile95(listTimes).toFixed(1)}ms`);
    assert.ok(
      percentile95(createTimes) <= CREATE_P95_MS,
      `追加 p95=${percentile95(createTimes).toFixed(1)}ms`,
    );
  });
});
