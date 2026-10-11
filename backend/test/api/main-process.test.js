// composition root（src/main.js）を実プロセスで検査する（環境変数・正常終了・破損 DB での起動）。テストケース外の補助検査。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { corruptDbFile, seedTasks, sha256File } from "../../test-support/db.js";
import { spawnBackend } from "../../test-support/process.js";
import { createSandbox } from "../../test-support/sandbox.js";
import { createClient } from "../helpers/harness.js";

const MAIN_JS = fileURLToPath(new URL("../../src/main.js", import.meta.url));

describe("src/main.js（実プロセス）", () => {
  const cleanups = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups.length = 0;
  });

  async function sandbox() {
    const created = await createSandbox();
    cleanups.push(() => created.cleanup());
    return created;
  }

  async function start(options) {
    const backend = await spawnBackend(options);
    cleanups.push(() => backend.stop());
    return backend;
  }

  it("[補助] SIGTERM・SIGINT で正常終了（終了コード 0）し、終了ログを出す", async () => {
    for (const signal of ["SIGTERM", "SIGINT"]) {
      const { dbPath } = await sandbox();
      const backend = await start({ dbPath });
      const exit = await backend.stop(signal);
      assert.deepEqual(exit, { code: 0, signal: null }, signal);
      assert.ok(backend.logs().some((line) => line.signal === signal));
    }
  });

  it("[補助] DB_PATH の親ディレクトリが無くても作り、初回起動として空の一覧を返す", async () => {
    const { path } = await sandbox();
    const dbPath = path("nested/dir/todo.db");
    const backend = await start({ dbPath });
    const res = await createClient(backend.url).get("/api/v1/tasks");
    assert.deepEqual(res.body, { tasks: [] });
    assert.ok(existsSync(dbPath));
  });

  it("[補助] 破損 DB でも起動でき（health 503）、起動ログに error が出て、ファイルは書き換えない", async () => {
    const { dbPath } = await sandbox();
    seedTasks(dbPath, STANDARD_TASKS);
    corruptDbFile(dbPath);
    const hash = sha256File(dbPath);

    const backend = await start({ dbPath });
    const client = createClient(backend.url);
    const health = await client.get("/api/v1/health");
    assert.equal(health.status, 503);
    assert.equal(health.body.db, "error");
    const startup = backend.logs().find((line) => line.level >= 50 && line.errorCode === "DATA_CORRUPT");
    assert.ok(startup, "起動ログに DATA_CORRUPT の error 行");
    await backend.stop();
    assert.equal(sha256File(dbPath), hash);
  });

  it("[補助] 不正な環境変数（PORT・LOG_LEVEL）では起動せず、非 0 で終了する", async () => {
    const { dbPath } = await sandbox();
    for (const env of [{ PORT: "abc" }, { PORT: "70000" }, { LOG_LEVEL: "loud" }]) {
      const result = spawnSync(process.execPath, [MAIN_JS], {
        env: { ...process.env, DB_PATH: dbPath, ...env },
        encoding: "utf8",
        timeout: 15000,
      });
      assert.notEqual(result.status, 0, JSON.stringify(env));
      assert.match(result.stderr, /PORT|LOG_LEVEL/);
    }
  });

  it("[補助] 使用中のポートでは起動に失敗して非 0 で終了する", async () => {
    const { dbPath, path } = await sandbox();
    const first = await start({ dbPath });
    const result = spawnSync(process.execPath, [MAIN_JS], {
      env: { ...process.env, DB_PATH: path("other.db"), HOST: "127.0.0.1", PORT: String(first.port) },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /起動に失敗した/);
  });
});
