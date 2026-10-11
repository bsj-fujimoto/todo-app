// SQLite ファイルを API を経由せず直接扱う関数群（シード・破損・不正行・内容確認）。
// 純粋な ESM 関数として export する。e2e からも使う。
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../src/store/migrations.js";

const DEFAULT_APPLIED_AT = "2026-10-01T00:00:00.000Z";
const INSERT_SQL = "INSERT INTO tasks (id, title, completed, created_at) VALUES (?, ?, ?, ?)";

function withDb(dbPath, options, work) {
  const db = new DatabaseSync(dbPath, options);
  try {
    return work(db);
  } finally {
    db.close();
  }
}

function insertAll(db, rows) {
  const insert = db.prepare(INSERT_SQL);
  db.exec("BEGIN");
  try {
    for (const row of rows) insert.run(row.id, row.title, row.completed ? 1 : 0, row.createdAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * スキーマ（マイグレーション v1）を作り、rows を配列の順（= 保存順）に INSERT する。
 * 同時刻の createdAt など、API では作れないデータ用。
 * @param {string} dbPath
 * @param {Array<{id: string, title: string, completed?: boolean, createdAt: string}>} rows
 * @param {{appliedAt?: string}} [options]
 */
export function seedTasks(dbPath, rows, { appliedAt = DEFAULT_APPLIED_AT } = {}) {
  withDb(dbPath, {}, (db) => {
    migrate(db, () => appliedAt);
    insertAll(db, rows);
  });
}

/**
 * CHECK 制約を迂回して、検証に通らない行を直接 INSERT する（スキーマが無ければ作る）。
 * 値は検証せずそのまま入れる（例: completed: 2、title: ""、createdAt: "yesterday"）。
 * @param {string} dbPath
 * @param {{id: unknown, title: unknown, completed: unknown, createdAt: unknown}} row
 */
export function insertInvalidRow(dbPath, row) {
  withDb(dbPath, {}, (db) => {
    migrate(db, () => DEFAULT_APPLIED_AT);
    db.exec("PRAGMA ignore_check_constraints = ON");
    db.prepare(INSERT_SQL).run(row.id, row.title, row.completed, row.createdAt);
  });
}

/** SQLite ファイルの先頭 bytes バイト（既定 100 = ヘッダ）を 0x00 で上書きして壊す（DS-007）。 */
export function corruptDbFile(dbPath, bytes = 100) {
  const fd = openSync(dbPath, "r+");
  try {
    writeSync(fd, Buffer.alloc(bytes, 0), 0, bytes, 0);
  } finally {
    closeSync(fd);
  }
}

/** ファイルの SHA-256（16 進）。書き換えられていないことの確認用。 */
export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** tasks の全行を保存順（seq 昇順）で返す。読み取り専用で開く（DB を書き換えない）。 */
export function readRows(dbPath) {
  return withDb(dbPath, { readOnly: true }, (db) =>
    db
      .prepare("SELECT seq, id, title, completed, created_at FROM tasks ORDER BY seq")
      .all()
      .map((row) => ({ ...row })),
  );
}

/** sqlite_master のテーブル名一覧。読み取り専用で開く。 */
export function listTables(dbPath) {
  return withDb(dbPath, { readOnly: true }, (db) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name),
  );
}
