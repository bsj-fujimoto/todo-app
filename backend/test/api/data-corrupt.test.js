// TC-052〜TC-054: 保存データの破損（DS-007）。読み書きすべてで 500 DATA_CORRUPT を返し、DB ファイルを一切書き換えない。
// 破損は 2 種類: ① SQLite ファイルとして読めない（先頭 100 バイトが 0x00）、② 開けるが行が検証に通らない。
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { corruptDbFile, insertInvalidRow, readRows, seedTasks, sha256File } from "../../test-support/db.js";
import { assertSpecError } from "../helpers/assertions.js";
import { createHarness, errorLogs } from "../helpers/harness.js";

const UNREGISTERED_ID = "00000000-0000-4000-8000-000000000000";
const [MILK] = STANDARD_TASKS;

function dataCorruptLogs(api) {
  return errorLogs(api.logs()).filter((line) => line.errorCode === "DATA_CORRUPT");
}

async function prepareCorruptDb(harness) {
  const { dbPath } = await harness.sandbox();
  seedTasks(dbPath, STANDARD_TASKS);
  corruptDbFile(dbPath);
  return dbPath;
}

describe("① SQLite ファイルとして読めない DB（DS-007）", () => {
  const harness = createHarness();
  afterEach(() => harness.cleanup());

  it("[TC-052] 一覧は 500 DATA_CORRUPT（空配列の 200 を返さない）で、DB ファイルは書き換えられない", async () => {
    const dbPath = await prepareCorruptDb(harness);
    const hashBefore = sha256File(dbPath);
    const api = await harness.start({ dbPath });
    const startupErrors = errorLogs(api.logs()).length;

    const res = await api.get("/api/v1/tasks");
    assertSpecError(res, 500, "DATA_CORRUPT");

    assert.equal(sha256File(dbPath), hashBefore, "空の DB で上書きされていない");
    const requestErrors = errorLogs(api.logs()).slice(startupErrors);
    assert.equal(requestErrors.length, 1, "手順 3 で error レベルの行がちょうど 1 件");
    assert.equal(requestErrors[0].errorCode, "DATA_CORRUPT");
  });

  it("[TC-053] 追加・完了切替・削除も 500 DATA_CORRUPT（PATCH・DELETE は 404 にならない）で、DB は変わらない", async () => {
    const dbPath = await prepareCorruptDb(harness);
    const hashBefore = sha256File(dbPath);
    const api = await harness.start({ dbPath });
    const startupErrors = errorLogs(api.logs()).length;

    assertSpecError(await api.post("/api/v1/tasks", { title: "資料を印刷する" }), 500, "DATA_CORRUPT");
    assertSpecError(
      await api.patch(`/api/v1/tasks/${UNREGISTERED_ID}`, { completed: true }),
      500,
      "DATA_CORRUPT",
    );
    assertSpecError(await api.delete(`/api/v1/tasks/${UNREGISTERED_ID}`), 500, "DATA_CORRUPT");

    assert.equal(sha256File(dbPath), hashBefore, "書込み系の操作でも破損ファイルを書き換えない");
    const requestErrors = errorLogs(api.logs()).slice(startupErrors);
    assert.equal(requestErrors.length, 3, "操作ごとに error レベルの行が出る");
    assert.ok(requestErrors.every((line) => line.errorCode === "DATA_CORRUPT"));
  });

  it("[TC-054] 起動・停止を繰り返しても破損ファイルを書き換えず、health は 503/degraded、正常な DB に替えれば 200", async () => {
    const dbPath = await prepareCorruptDb(harness);
    const hashBefore = sha256File(dbPath);

    for (let round = 1; round <= 3; round += 1) {
      const api = await harness.start({ dbPath });
      const health = await api.get("/api/v1/health");
      assert.equal(health.status, 503, `round ${round}`);
      assert.deepEqual(health.body, {
        status: "degraded",
        version: "1.0.0-test",
        commit: "unknown",
        db: "error",
      });
      assertSpecError(await api.get("/api/v1/tasks"), 500, "DATA_CORRUPT");
      assert.ok(dataCorruptLogs(api).length >= 1, "起動ごとに DB を開けなかったことを示す error 行が出る");
      assert.ok(dataCorruptLogs(api).some((line) => line.msg === "データストアを開けなかった"));
      await api.stop();
    }
    assert.equal(sha256File(dbPath), hashBefore, "起動を繰り返しても初期化処理が書き換えない");

    await rm(dbPath);
    seedTasks(dbPath, STANDARD_TASKS);
    const recovered = await harness.start({ dbPath });
    const health = await recovered.get("/api/v1/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: "ok", version: "1.0.0-test", commit: "unknown", db: "ok" });
  });
});

const INVALID_ROWS = [
  ["title が空", { title: "" }],
  ["title が空白だけ", { title: "   " }],
  ["title が 101 コードポイント", { title: "a".repeat(101) }],
  ["title に改行を含む", { title: "a\nb" }],
  ["title の前後に空白が残っている", { title: " 余白あり " }],
  ["created_at が ISO 8601 でない", { createdAt: "yesterday" }],
  ["created_at がミリ秒・Z のない日付だけ", { createdAt: "2026-10-01" }],
  ["created_at が存在しない日付", { createdAt: "2026-02-31T00:00:00.000Z" }],
  ["completed が 0/1 でない（数値 2）", { completed: 2 }],
  ["completed が 0/1 でない（文字列）", { completed: "yes" }],
  ["id が UUID でない", { id: "not-a-uuid" }],
];

describe("② 開けるが行が検証に通らない DB（CHECK 制約を迂回して直接挿入）", () => {
  const harness = createHarness();
  afterEach(() => harness.cleanup());

  for (const [name, override] of INVALID_ROWS) {
    it(`[TC-052] [TC-053] ${name}: 読み書きすべてが 500 DATA_CORRUPT で、DB は変わらない`, async () => {
      const { dbPath } = await harness.sandbox();
      seedTasks(dbPath, STANDARD_TASKS);
      insertInvalidRow(dbPath, {
        id: "5f1b0c1e-9999-4a99-8a99-000000000001",
        title: "不正な行",
        completed: 0,
        createdAt: "2026-10-01T09:00:09.000Z",
        ...override,
      });
      const hashBefore = sha256File(dbPath);
      const rowsBefore = readRows(dbPath);
      const api = await harness.start({ dbPath });

      assertSpecError(await api.get("/api/v1/tasks"), 500, "DATA_CORRUPT");
      assertSpecError(await api.post("/api/v1/tasks", { title: "資料を印刷する" }), 500, "DATA_CORRUPT");
      assertSpecError(await api.patch(`/api/v1/tasks/${MILK.id}`, { completed: true }), 500, "DATA_CORRUPT");
      assertSpecError(await api.delete(`/api/v1/tasks/${MILK.id}`), 500, "DATA_CORRUPT");
      assertSpecError(await api.delete(`/api/v1/tasks/${UNREGISTERED_ID}`), 500, "DATA_CORRUPT");

      assert.equal(sha256File(dbPath), hashBefore);
      assert.deepEqual(readRows(dbPath), rowsBefore);
      assert.equal(dataCorruptLogs(api).length, 5);
    });
  }

  it("[補助] 正常な行は壊れた行とみなさない（title の途中の連続空白・タブは有効）", async () => {
    const { dbPath } = await harness.sandbox();
    seedTasks(dbPath, [{ ...MILK, title: "a  b\t c" }]);
    const api = await harness.start({ dbPath });
    const res = await api.get("/api/v1/tasks");
    assert.equal(res.status, 200);
    assert.equal(res.body.tasks[0].title, "a  b\t c");
  });

  it("[補助] DB が空・ファイル未作成なら初回起動として正常（テーブルを作り空一覧）", async () => {
    const { dbPath } = await harness.sandbox();
    const api = await harness.start({ dbPath });
    assert.deepEqual((await api.get("/api/v1/tasks")).body, { tasks: [] });
    assert.deepEqual(errorLogs(api.logs()), []);
    assert.equal(readRows(dbPath).length, 0);
  });
});
