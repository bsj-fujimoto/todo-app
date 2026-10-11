// バージョン管理されたマイグレーション。前進のみ・冪等・1 件ずつトランザクション内で適用する。
// フェーズ2では version 2 を足す（既存の定義は書き換えない）。

export const MIGRATIONS = Object.freeze([
  {
    version: 1,
    name: "create tasks",
    sql: `
      CREATE TABLE IF NOT EXISTS tasks (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
        created_at TEXT NOT NULL
      );
    `,
  },
]);

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`;

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function appliedVersions(db) {
  const table = db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  if (!table.get()) return new Set();
  return new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => row.version),
  );
}

/** 未適用のマイグレーションの一覧（読み取りだけで判定する。書き込めない DB でも呼べる）。 */
export function pendingMigrations(db, migrations = MIGRATIONS) {
  const applied = appliedVersions(db);
  return migrations.filter((migration) => !applied.has(migration.version));
}

function applyOne(db, migration, clock) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(CREATE_MIGRATIONS_TABLE);
    // ロック取得後に再確認する（複数プロセスが同時に起動しても二重に適用しない）
    if (!appliedVersions(db).has(migration.version)) {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        clock(),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * 未適用のマイグレーションを順に適用する。適用済みなら何も書かない（読み取り専用の DB でも起動できる）。
 * @returns {number[]} 今回適用したバージョン
 */
export function migrate(db, clock, migrations = MIGRATIONS) {
  const pending = pendingMigrations(db, migrations);
  for (const migration of pending) applyOne(db, migration, clock);
  return pending.map((migration) => migration.version);
}
