// 純粋関数の補助検査: 保存行の検証・エラー分類・環境変数の解釈・エラー封筒。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../../src/config.js";
import { findInvalidColumn, isCanonicalIsoUtc, isUuid, rowToTask } from "../../src/domain/task.js";
import { AppError, ERROR_DEFS, errorBody, statusOf } from "../../src/errors.js";
import { classifySqliteError, primaryCode } from "../../src/store/sqlite-errors.js";
import { parseCreateBody, parseId, parseUpdateBody } from "../../src/http/request.js";
import {
  fixedClock,
  sequentialIdGenerator,
  sequentialRequestIds,
  steppingClock,
} from "../../test-support/clock.js";

const VALID_ROW = {
  id: "5f1b0c1e-1111-4a11-8a11-000000000001",
  title: "牛乳を買う",
  completed: 0,
  created_at: "2026-10-01T09:00:00.000Z",
};

describe("保存行の検証（DATA_CORRUPT の判定材料）", () => {
  it("[補助] 正しい行は問題なし、Task への変換は completed を真偽値にする", () => {
    assert.equal(findInvalidColumn(VALID_ROW), null);
    assert.deepEqual(rowToTask({ ...VALID_ROW, completed: 1 }), {
      id: VALID_ROW.id,
      title: "牛乳を買う",
      completed: true,
      createdAt: VALID_ROW.created_at,
    });
  });

  it("[補助] 壊れた列の名前を返す（値は返さない）", () => {
    const cases = [
      [{ id: "x" }, "id"],
      [{ id: null }, "id"],
      [{ title: "" }, "title"],
      [{ title: null }, "title"],
      [{ title: 5 }, "title"],
      [{ title: "a\rb" }, "title"],
      [{ title: "😀".repeat(101) }, "title"],
      [{ completed: 2 }, "completed"],
      [{ completed: "0" }, "completed"],
      [{ completed: null }, "completed"],
      [{ created_at: "2026-10-01T09:00:00Z" }, "created_at"],
      [{ created_at: "2026-10-01T09:00:00.000+09:00" }, "created_at"],
      [{ created_at: null }, "created_at"],
    ];
    for (const [override, column] of cases) {
      assert.equal(findInvalidColumn({ ...VALID_ROW, ...override }), column, JSON.stringify(override));
    }
  });

  it("[補助] 100 コードポイントちょうどの title・大文字の UUID は正しい行", () => {
    assert.equal(findInvalidColumn({ ...VALID_ROW, title: "😀".repeat(100) }), null);
    assert.equal(findInvalidColumn({ ...VALID_ROW, id: VALID_ROW.id.toUpperCase() }), null);
  });

  it("[補助] isUuid / isCanonicalIsoUtc", () => {
    assert.equal(isUuid(VALID_ROW.id), true);
    assert.equal(isUuid("abc"), false);
    assert.equal(isUuid(`${VALID_ROW.id}x`), false);
    assert.equal(isUuid(undefined), false);
    assert.equal(isCanonicalIsoUtc("2026-10-01T09:00:00.000Z"), true);
    assert.equal(isCanonicalIsoUtc("2026-13-01T09:00:00.000Z"), false);
    assert.equal(isCanonicalIsoUtc(20261001), false);
  });
});

describe("リクエストの構造検査", () => {
  it("[補助] 正しい本文・id は値を返し、それ以外は INVALID_REQUEST を投げる", () => {
    assert.equal(parseCreateBody({ title: "a" }), "a");
    assert.equal(parseUpdateBody({ completed: false }), false);
    assert.equal(parseId(VALID_ROW.id), VALID_ROW.id);
    const bad = [
      () => parseCreateBody(undefined),
      () => parseCreateBody(null),
      () => parseCreateBody([]),
      () => parseCreateBody({}),
      () => parseCreateBody({ title: 1 }),
      () => parseCreateBody({ title: "a", extra: true }),
      () => parseCreateBody({ other: "a" }),
      () => parseUpdateBody({ completed: "true" }),
      () => parseUpdateBody({ completed: true, title: "x" }),
      () => parseId("123"),
    ];
    for (const run of bad)
      assert.throws(run, (error) => error instanceof AppError && error.code === "INVALID_REQUEST");
  });
});

describe("SQLite 例外の分類", () => {
  const sqliteError = (errcode) => Object.assign(new Error("sqlite"), { errcode, errstr: `code ${errcode}` });

  it("[補助] ファイルの破損（CORRUPT=11・NOTADB=26）は DATA_CORRUPT", () => {
    for (const errcode of [11, 26, 11 | (1 << 8)]) {
      assert.equal(classifySqliteError(sqliteError(errcode)).code, "DATA_CORRUPT", String(errcode));
    }
  });

  it("[補助] 読取専用・容量不足・ロック・I/O 障害・開けないは STORAGE_FAILURE（拡張コードは下位 8 ビットで判定）", () => {
    for (const errcode of [5, 6, 7, 8, 10, 13, 14, 15, 8 | (2 << 8), 10 | (3 << 8)]) {
      assert.equal(classifySqliteError(sqliteError(errcode)).code, "STORAGE_FAILURE", String(errcode));
    }
  });

  it("[補助] 分類できない例外（制約違反・SQLite 以外）は INTERNAL_ERROR、AppError はそのまま", () => {
    assert.equal(classifySqliteError(sqliteError(19)).code, "INTERNAL_ERROR");
    assert.equal(classifySqliteError(new Error("x")).code, "INTERNAL_ERROR");
    assert.equal(classifySqliteError(undefined).code, "INTERNAL_ERROR");
    const own = new AppError("DATA_CORRUPT");
    assert.equal(classifySqliteError(own), own);
    assert.equal(primaryCode({ errcode: 266 }), 10);
    assert.equal(primaryCode({}), null);
  });

  it("[補助] 原因（cause）と検出内容（detail）を保持する", () => {
    const cause = sqliteError(8);
    const classified = classifySqliteError(cause);
    assert.equal(classified.cause, cause);
    assert.equal(classified.detail, "sqlite code 8");
  });
});

describe("エラーコードと HTTP 写像", () => {
  it("[補助] 封筒は {error: {code, message}} で、status は契約の宣言どおり", () => {
    assert.deepEqual(errorBody("STORAGE_FAILURE"), {
      error: { code: "STORAGE_FAILURE", message: "保存できませんでした。もう一度お試しください" },
    });
    const statuses = Object.fromEntries(Object.keys(ERROR_DEFS).map((code) => [code, statusOf(code)]));
    assert.deepEqual(statuses, {
      TITLE_REQUIRED: 422,
      TITLE_TOO_LONG: 422,
      TITLE_MULTILINE: 422,
      INVALID_REQUEST: 400,
      TASK_NOT_FOUND: 404,
      STORAGE_FAILURE: 503,
      DATA_CORRUPT: 500,
      INTERNAL_ERROR: 500,
      ROUTE_NOT_FOUND: 404,
    });
  });
});

describe("環境変数の解釈", () => {
  it("[補助] 未指定は既定値（PORT 3000・HOST 0.0.0.0・DB_PATH /data/todo.db・COMMIT_SHA unknown・LOG_LEVEL info）", () => {
    const defaults = {
      port: 3000,
      host: "0.0.0.0",
      dbPath: "/data/todo.db",
      commitSha: "unknown",
      logLevel: "info",
    };
    assert.deepEqual(loadConfig({}), defaults);
    assert.deepEqual(
      loadConfig({ PORT: "", HOST: "", DB_PATH: "", COMMIT_SHA: "", LOG_LEVEL: "" }),
      defaults,
    );
  });

  it("[補助] 指定した値を使う", () => {
    const env = {
      PORT: "8080",
      HOST: "127.0.0.1",
      DB_PATH: "/tmp/x.db",
      COMMIT_SHA: "abc",
      LOG_LEVEL: "debug",
    };
    assert.deepEqual(loadConfig(env), {
      port: 8080,
      host: "127.0.0.1",
      dbPath: "/tmp/x.db",
      commitSha: "abc",
      logLevel: "debug",
    });
    assert.equal(loadConfig({ PORT: "0" }).port, 0);
  });

  it("[補助] 不正な PORT・LOG_LEVEL は例外", () => {
    for (const env of [
      { PORT: "abc" },
      { PORT: "-1" },
      { PORT: "65536" },
      { PORT: "80.5" },
      { LOG_LEVEL: "loud" },
    ]) {
      assert.throws(() => loadConfig(env), /PORT|LOG_LEVEL/, JSON.stringify(env));
    }
  });
});

describe("test-support の決定的な供給元", () => {
  it("[補助] fixedClock・steppingClock・連番 ID", () => {
    assert.equal(fixedClock("2026-10-01T00:00:00.000Z")(), "2026-10-01T00:00:00.000Z");
    const stepping = steppingClock("2026-10-01T00:00:00.000Z", 1500);
    assert.deepEqual(
      [stepping(), stepping(), stepping()],
      ["2026-10-01T00:00:00.000Z", "2026-10-01T00:00:01.500Z", "2026-10-01T00:00:03.000Z"],
    );
    const paired = steppingClock("2026-10-01T00:00:00.000Z", 1000, 2);
    assert.deepEqual(
      [paired(), paired(), paired()],
      ["2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:01.000Z"],
    );
    const ids = sequentialIdGenerator();
    assert.deepEqual(
      [ids(), ids()],
      ["11111111-1111-4111-8111-000000000001", "11111111-1111-4111-8111-000000000002"],
    );
    assert.ok(isUuid(ids()));
    assert.deepEqual([sequentialRequestIds("r")(), sequentialRequestIds()()], ["r-1", "test-req-1"]);
  });
});
