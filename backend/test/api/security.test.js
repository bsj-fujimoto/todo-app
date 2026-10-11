// TC-059, TC-060: 直接 API・不正入力・インジェクション文字列。
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MALICIOUS_TITLES, STANDARD_TASKS } from "../../test-support/datasets.js";
import { listTables, readRows, seedTasks } from "../../test-support/db.js";
import { assertSpecError } from "../helpers/assertions.js";
import { createHarness, errorLogs } from "../helpers/harness.js";

describe("セキュリティ（直接 API・不正入力）", () => {
  const harness = createHarness();
  afterEach(() => harness.cleanup());

  it("[TC-059] 認証なしで全操作でき（401/403・WWW-Authenticate・Set-Cookie なし）、画面を経由しない不正入力は backend が断る", async () => {
    const { dbPath } = await harness.sandbox();
    seedTasks(dbPath, STANDARD_TASKS);
    const api = await harness.start({ dbPath });
    const responses = [];
    const track = (response) => {
      responses.push(response);
      return response;
    };

    assert.equal(track(await api.get("/api/v1/tasks")).status, 200);
    const created = track(await api.post("/api/v1/tasks", { title: "資料を印刷する" }));
    assert.equal(created.status, 201);
    assert.equal(track(await api.patch(`/api/v1/tasks/${created.body.id}`, { completed: true })).status, 200);
    assert.equal(track(await api.delete(`/api/v1/tasks/${created.body.id}`)).status, 204);
    assert.equal(readRows(dbPath).length, 3, "手順 2 の行は削除済みで 3 行");

    assertSpecError(
      track(await api.post("/api/v1/tasks", { title: "a".repeat(101) })),
      422,
      "TITLE_TOO_LONG",
    );
    assert.equal(readRows(dbPath).length, 3, "手順 4 では行が増えない");

    for (const response of responses) {
      assert.equal(response.headers.get("www-authenticate"), null);
      assert.equal(response.headers.get("set-cookie"), null);
    }
    assert.equal(api.completedLogs().filter((log) => [401, 403].includes(log.statusCode)).length, 0);
  });

  it("[TC-060] HTML・SQL の断片を含むタイトルは、そのまま（変換・除去・実行なしで）保存され、そのまま返る", async () => {
    const { dbPath } = await harness.sandbox();
    const api = await harness.start({ dbPath });

    for (const title of MALICIOUS_TITLES) {
      const res = await api.post("/api/v1/tasks", { title });
      assert.equal(res.status, 201, title);
      assert.equal(res.body.title, title, "エスケープ・タグ除去・引用符の削除をしない");
    }

    const list = await api.get("/api/v1/tasks");
    assert.equal(list.status, 200);
    assert.match(list.headers.get("content-type"), /^application\/json/);
    assert.equal(list.body.tasks.length, 6);
    assert.deepEqual(list.body.tasks.map((task) => task.title).sort(), [...MALICIOUS_TITLES].sort());

    assert.ok(listTables(dbPath).includes("tasks"), "DROP TABLE が実行されていない");
    const rows = readRows(dbPath);
    assert.equal(rows.length, 6);
    assert.deepEqual(
      rows.map((row) => row.title),
      MALICIOUS_TITLES,
    );
    assert.ok(
      api
        .completedLogs()
        .filter((log) => log.method === "POST")
        .every((log) => log.statusCode === 201),
    );
    assert.deepEqual(errorLogs(api.logs()), []);
  });
});
