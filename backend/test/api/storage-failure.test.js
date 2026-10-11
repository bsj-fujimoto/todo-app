// TC-050, TC-051: 保存失敗（DS-008: DB ファイルを chmod 0444 にした書込み不可環境）。操作は反映されず 503 STORAGE_FAILURE。
// root は読取専用ビットを無視するため、root で実行されたときはスキップする。後始末（権限を戻して削除）は sandbox.cleanup()。
import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import { afterEach, beforeEach, describe, it } from "node:test";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { readRows, seedTasks, sha256File } from "../../test-support/db.js";
import { assertSpecError, titlesOf } from "../helpers/assertions.js";
import { createHarness } from "../helpers/harness.js";

const isRoot = process.getuid?.() === 0;
const [MILK, SPEC, PREP] = STANDARD_TASKS;

function storageFailureLogs(api) {
  return api.logs().filter((line) => line.level >= 50 && line.errorCode === "STORAGE_FAILURE");
}

describe("DS-008 書込み不可環境", { skip: isRoot && "root は chmod 0444 を無視する" }, () => {
  const harness = createHarness();
  let dbPath;
  let api;

  beforeEach(async () => {
    ({ dbPath } = await harness.sandbox());
    seedTasks(dbPath, STANDARD_TASKS);
    await chmod(dbPath, 0o444);
    api = await harness.start({ dbPath });
  });
  afterEach(() => harness.cleanup());

  it("[TC-050] 追加は 503 STORAGE_FAILURE で DB に一切書かれず、権限を戻すと同じ操作が 1 回だけ成功する", async () => {
    const hashBefore = sha256File(dbPath);

    const failed = await api.post("/api/v1/tasks", { title: "資料を印刷する" });
    assertSpecError(failed, 503, "STORAGE_FAILURE");
    assert.deepEqual(titlesOf(await api.get("/api/v1/tasks")), [PREP.title, SPEC.title, MILK.title]);
    assert.equal(sha256File(dbPath), hashBefore, "失敗した追加が保存データに途中まで書き込まれていない");
    assert.equal(storageFailureLogs(api).length, 1, "手順 2 で error レベルの行がちょうど 1 件");

    await chmod(dbPath, 0o644);
    const retried = await api.post("/api/v1/tasks", { title: "資料を印刷する" });
    assert.equal(retried.status, 201);
    assert.equal((await api.get("/api/v1/tasks")).body.tasks.length, 4);
    const rows = readRows(dbPath);
    assert.equal(rows.length, 4);
    assert.equal(rows.filter((row) => row.title === "資料を印刷する").length, 1, "再試行で重複しない");
  });

  it("[TC-051] 完了切替・削除も 503 STORAGE_FAILURE で、行は部分的にも変わらず、それぞれ error ログが出る", async () => {
    const hashBefore = sha256File(dbPath);
    const rowsBefore = readRows(dbPath);

    assertSpecError(await api.patch(`/api/v1/tasks/${MILK.id}`, { completed: true }), 503, "STORAGE_FAILURE");
    assert.equal(storageFailureLogs(api).length, 1);
    assertSpecError(await api.delete(`/api/v1/tasks/${MILK.id}`), 503, "STORAGE_FAILURE");
    assert.equal(storageFailureLogs(api).length, 2);

    const list = await api.get("/api/v1/tasks");
    assert.equal(list.body.tasks.length, 3);
    assert.equal(list.body.tasks.find((task) => task.id === MILK.id).completed, false);
    assert.deepEqual(readRows(dbPath), rowsBefore);
    assert.equal(sha256File(dbPath), hashBefore);
  });

  it("[補助] 読み取り（一覧・health）は書込み不可でも成功し、権限を戻せば再起動なしで完了切替できる", async () => {
    assert.equal((await api.get("/api/v1/tasks")).status, 200);
    const health = await api.get("/api/v1/health");
    assert.deepEqual(health.body, { status: "ok", version: "1.0.0-test", commit: "unknown", db: "ok" });

    await chmod(dbPath, 0o644);
    const updated = await api.patch(`/api/v1/tasks/${MILK.id}`, { completed: true });
    assert.equal(updated.status, 200);
    assert.equal(readRows(dbPath).find((row) => row.id === MILK.id).completed, 1);
  });
});
