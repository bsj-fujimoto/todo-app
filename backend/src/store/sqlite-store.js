// SQLite ストア（node:sqlite の DatabaseSync。ネイティブアドオンなし）。
//
// 方針:
// - 操作ごとに接続を開いて閉じる（常駐させない）。開けない・壊れていても backend は起動でき、
//   権限を戻す・ファイルを差し替える・復元するといった運用操作が、再起動なしで次の操作から効く
//   （読取専用で開いた接続は、権限を戻しても書けないままになるため、常駐接続だと復旧できない）。
// - 開けるだけなら DB ファイルへ一切書かない。未適用のマイグレーションがあるときだけ書く。
//   破損ファイルは「開けない」ので、初期化処理が上書き・修復・テーブル作成をすることはない。
// - すべての操作は先に全行を検証し、1 行でも契約に沿わなければ DATA_CORRUPT で拒否する。
// - journal_mode は既定の DELETE のまま（WAL にしない。読取専用ファイルでも読み取りは成功する）。
import { DatabaseSync } from "node:sqlite";
import { AppError } from "../errors.js";
import { findInvalidColumn, rowToTask } from "../domain/task.js";
import { migrate } from "./migrations.js";
import { classifySqliteError } from "./sqlite-errors.js";

const BUSY_TIMEOUT_MS = 2000;
const SELECT_ALL =
  "SELECT seq, id, title, completed, created_at FROM tasks ORDER BY created_at DESC, seq DESC";

function validatedTasks(rows) {
  return rows.map((row) => {
    const column = findInvalidColumn(row);
    if (column) throw new AppError("DATA_CORRUPT", { detail: `invalid ${column} in row seq=${row.seq}` });
    return rowToTask(row);
  });
}

function readAll(db) {
  return validatedTasks(db.prepare(SELECT_ALL).all());
}

function insertTask(db, task) {
  readAll(db);
  db.prepare("INSERT INTO tasks (id, title, completed, created_at) VALUES (?, ?, ?, ?)").run(
    task.id,
    task.title,
    task.completed ? 1 : 0,
    task.createdAt,
  );
  return task;
}

function updateCompleted(db, id, completed) {
  const current = readAll(db).find((task) => task.id === id);
  if (!current) return null;
  db.prepare("UPDATE tasks SET completed = ? WHERE id = ?").run(completed ? 1 : 0, id);
  return { ...current, completed };
}

function removeTask(db, id) {
  if (!readAll(db).some((task) => task.id === id)) return false;
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  return true;
}

/** 接続を開いて（必要ならマイグレーションして）operation に渡し、必ず閉じる。例外は AppError に分類する。 */
function connector({ dbPath, clock }) {
  return (operation) => {
    let db = null;
    try {
      db = new DatabaseSync(dbPath, { timeout: BUSY_TIMEOUT_MS });
      migrate(db, clock);
      return operation(db);
    } catch (error) {
      throw classifySqliteError(error);
    } finally {
      db?.close();
    }
  };
}

/**
 * @param {{dbPath: string, clock: () => string}} deps clock は schema_migrations.applied_at 用（ISO 8601 文字列を返す）
 */
export function createStore(deps) {
  const withConnection = connector(deps);
  return {
    /** 接続できるか。{ok: true} か {ok: false, error: AppError}。 */
    status() {
      try {
        withConnection((db) => db.prepare("SELECT 1 AS ok FROM sqlite_master LIMIT 1").get());
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    },
    /** 全件（createdAt 降順・同時刻は保存順の新しい方が先）。壊れた行があれば DATA_CORRUPT。 */
    listTasks: () => withConnection(readAll),
    /** 全行を検証してから追加する。task は {id, title, completed, createdAt}。 */
    createTask: (task) => withConnection((db) => insertTask(db, task)),
    /** 全行を検証してから completed だけを更新する。無ければ null。 */
    setCompleted: (id, completed) => withConnection((db) => updateCompleted(db, id, completed)),
    /** 全行を検証してから削除する。削除したら true、無ければ false。 */
    deleteTask: (id) => withConnection((db) => removeTask(db, id)),
    /** 常駐接続を持たないため何もしない（呼び出し側が store の寿命を管理しやすいよう残している）。 */
    close() {},
  };
}
