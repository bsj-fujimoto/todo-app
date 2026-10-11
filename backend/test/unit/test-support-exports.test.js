// e2e など他の workspace が `@todo-app/backend/test-support` で読み込めること（README に書いた公開 API の確認）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("@todo-app/backend/test-support", () => {
  it("[補助] workspace の名前で読み込め、README に書いた関数・データセットが export されている", async () => {
    const support = await import("@todo-app/backend/test-support");
    for (const name of [
      "seedTasks",
      "corruptDbFile",
      "insertInvalidRow",
      "readRows",
      "listTables",
      "sha256File",
      "fixedClock",
      "steppingClock",
      "sequentialIdGenerator",
      "sequentialRequestIds",
      "spawnBackend",
      "createSandbox",
      "bulkTasks",
    ]) {
      assert.equal(typeof support[name], "function", name);
    }
    assert.equal(support.STANDARD_TASKS.length, 3);
    assert.equal(support.SAME_TIME_TASKS.length, 3);
    assert.equal(support.MALICIOUS_TITLES.length, 6);
  });
});
