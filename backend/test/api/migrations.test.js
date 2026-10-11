// マイグレーション（バージョン管理・前進のみ・冪等・トランザクション内）とスキーマ。テストケース外の補助検査。
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { LATEST_VERSION, MIGRATIONS, migrate, pendingMigrations } from "../../src/store/migrations.js";
import { createSandbox } from "../../test-support/sandbox.js";

const T1 = "2026-10-01T00:00:00.000Z";
const T2 = "2026-10-02T00:00:00.000Z";

describe("マイグレーション", () => {
  let sandbox;
  let db;
  beforeEach(async () => {
    sandbox = await createSandbox();
    db = new DatabaseSync(sandbox.dbPath);
  });
  afterEach(async () => {
    db.close();
    await sandbox.cleanup();
  });

  const versions = () =>
    db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();

  it("[補助] 空の DB に v1 を適用し、schema_migrations に記録する（tasks は契約どおりの列と制約）", () => {
    assert.deepEqual(
      migrate(db, () => T1),
      [1],
    );
    assert.deepEqual(
      versions().map((row) => ({ ...row })),
      [{ version: 1, applied_at: T1 }],
    );
    const columns = db.prepare("PRAGMA table_info(tasks)").all();
    assert.deepEqual(
      columns.map((column) => [column.name, column.type, column.notnull, column.pk]),
      [
        ["seq", "INTEGER", 0, 1],
        ["id", "TEXT", 1, 0],
        ["title", "TEXT", 1, 0],
        ["completed", "INTEGER", 1, 0],
        ["created_at", "TEXT", 1, 0],
      ],
    );
    const insert = db.prepare("INSERT INTO tasks (id, title, completed, created_at) VALUES (?, ?, ?, ?)");
    insert.run("a", "t", 0, T1);
    assert.throws(() => insert.run("a", "t", 0, T1), /UNIQUE/);
    assert.throws(() => insert.run("b", "t", 2, T1), /CHECK/);
    assert.ok(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE sql LIKE '%AUTOINCREMENT%'").get());
  });

  it("[補助] 冪等: 2 回目は何も適用せず、applied_at も変わらない（適用済みなら DB を書かない）", () => {
    migrate(db, () => T1);
    const clock = () => assert.fail("適用済みなら clock を呼ばない");
    assert.deepEqual(migrate(db, clock), []);
    assert.deepEqual(pendingMigrations(db), []);
    assert.equal(versions()[0].applied_at, T1);
    assert.equal(versions().length, LATEST_VERSION);
  });

  it("[補助] 前進のみ: 後から足した v2 だけが適用され、既存データは保たれる", () => {
    migrate(db, () => T1);
    db.prepare("INSERT INTO tasks (id, title, completed, created_at) VALUES (?, ?, ?, ?)").run(
      "a",
      "t",
      0,
      T1,
    );
    const v2 = { version: 2, name: "add due", sql: "ALTER TABLE tasks ADD COLUMN due_date TEXT;" };

    assert.deepEqual(
      migrate(db, () => T2, [...MIGRATIONS, v2]),
      [2],
    );
    assert.deepEqual(
      migrate(db, () => T2, [...MIGRATIONS, v2]),
      [],
    );
    assert.deepEqual(
      versions().map((row) => ({ ...row })),
      [
        { version: 1, applied_at: T1 },
        { version: 2, applied_at: T2 },
      ],
    );
    assert.equal(db.prepare("SELECT title, due_date FROM tasks").get().due_date, null);
  });

  it("[補助] トランザクション内: 途中で失敗した migration は巻き戻り、バージョンも記録されない", () => {
    migrate(db, () => T1);
    const broken = {
      version: 2,
      name: "broken",
      sql: "CREATE TABLE half (a); INSERT INTO missing_table VALUES (1);",
    };

    assert.throws(() => migrate(db, () => T2, [...MIGRATIONS, broken]), /no such table/);
    assert.equal(db.isTransaction, false);
    assert.equal(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE name = 'half'").get(), undefined);
    assert.deepEqual(
      versions().map((row) => row.version),
      [1],
    );
  });

  it("[補助] schema_migrations が無い既存の tasks（v1 相当）にも冪等に v1 を記録できる", () => {
    db.exec(MIGRATIONS[0].sql);
    assert.deepEqual(
      migrate(db, () => T1),
      [1],
    );
    assert.deepEqual(
      versions().map((row) => row.version),
      [1],
    );
  });
});
