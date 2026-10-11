// 運用性: x-request-id（レスポンスヘッダとログ）、ログの構造、利用者データをログに出さないこと（テストケース外の補助検査）。
import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { seedTasks } from "../../test-support/db.js";
import { createHarness } from "../helpers/harness.js";

const SECRET_TITLE = "ログに出てはいけない秘密のタイトル";

describe("x-request-id とログ", () => {
  const harness = createHarness();
  afterEach(() => harness.cleanup());

  async function start() {
    const { dbPath } = await harness.sandbox();
    seedTasks(dbPath, STANDARD_TASKS);
    return { dbPath, api: await harness.start({ dbPath }) };
  }

  it("[補助] 受け取った x-request-id を応答ヘッダとログにそのまま使う", async () => {
    const { api } = await start();
    const res = await api.get("/api/v1/tasks", { headers: { "x-request-id": "trace-abc.123:xyz" } });
    assert.equal(res.headers.get("x-request-id"), "trace-abc.123:xyz");
    const logged = api.completedLogs().find((log) => log.reqId === "trace-abc.123:xyz");
    assert.equal(logged.method, "GET");
    assert.equal(logged.statusCode, 200);
  });

  it("[補助] 無ければ（注入された採番で）採番し、危険な値（改行・長すぎる値）は採用しない", async () => {
    const { api } = await start();
    const generated = await api.get("/api/v1/tasks");
    assert.match(generated.headers.get("x-request-id"), /^test-req-\d+$/);

    const tooLong = await api.get("/api/v1/tasks", { headers: { "x-request-id": "a".repeat(200) } });
    assert.match(tooLong.headers.get("x-request-id"), /^test-req-\d+$/);
    const spaced = await api.get("/api/v1/tasks", { headers: { "x-request-id": "has space" } });
    assert.match(spaced.headers.get("x-request-id"), /^test-req-\d+$/);
  });

  it("[補助] エラー応答（400・404・422）にも x-request-id が付き、リクエストごとに別の値になる", async () => {
    const { api } = await start();
    const responses = [
      await api.post("/api/v1/tasks", { title: "" }),
      await api.post("/api/v1/tasks", { nope: 1 }),
      await api.delete("/api/v1/tasks/00000000-0000-4000-8000-000000000000"),
      await api.get("/api/v1/unknown"),
    ];
    const ids = responses.map((res) => res.headers.get("x-request-id"));
    assert.ok(ids.every(Boolean));
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(
      api.completedLogs().map((log) => log.reqId),
      ids,
    );
  });

  it("[補助] タイトルなどの利用者データはログに出ない（成功・検証エラー・保存失敗のいずれでも）", async () => {
    const isRoot = process.getuid?.() === 0;
    const { dbPath, api } = await start();
    await api.post("/api/v1/tasks", { title: SECRET_TITLE });
    await api.post("/api/v1/tasks", { title: `${SECRET_TITLE}\n改行` });
    await api.post("/api/v1/tasks", { title: SECRET_TITLE.repeat(10), extra: 1 });
    if (!isRoot) {
      await chmod(dbPath, 0o444);
      await api.post("/api/v1/tasks", { title: SECRET_TITLE });
    }
    const text = JSON.stringify(api.logs());
    assert.equal(text.includes(SECRET_TITLE), false);
    assert.equal(text.includes("牛乳を買う"), false);
  });

  it("[補助] ログは pino の JSON 行で、完了ログに reqId・statusCode・応答時間がある", async () => {
    const { api } = await start();
    await api.get("/api/v1/health");
    const completed = api.logs().find((line) => line.msg === "request completed");
    assert.equal(typeof completed.time, "number");
    assert.equal(completed.level, 30);
    assert.equal(completed.res.statusCode, 200);
    assert.equal(typeof completed.responseTime, "number");
    assert.ok(completed.reqId);
  });
});
