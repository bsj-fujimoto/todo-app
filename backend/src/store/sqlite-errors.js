// SQLite の例外を、アプリケーションのエラーコードへ分類する。
// node:sqlite の例外は errcode（SQLite の結果コード。拡張コードは下位 8 ビットが一次コード）を持つ。
import { AppError } from "../errors.js";

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_NOMEM = 7;
const SQLITE_READONLY = 8;
const SQLITE_IOERR = 10;
const SQLITE_CORRUPT = 11;
const SQLITE_FULL = 13;
const SQLITE_CANTOPEN = 14;
const SQLITE_PROTOCOL = 15;
const SQLITE_NOTADB = 26;

// ファイルとして壊れている（開けない・読めない）
const CORRUPT_CODES = new Set([SQLITE_CORRUPT, SQLITE_NOTADB]);
// 書込み先の状態の問題（読取専用・容量不足・ロック・I/O 障害など）。操作は反映されない
const STORAGE_CODES = new Set([
  SQLITE_BUSY,
  SQLITE_LOCKED,
  SQLITE_NOMEM,
  SQLITE_READONLY,
  SQLITE_IOERR,
  SQLITE_FULL,
  SQLITE_CANTOPEN,
  SQLITE_PROTOCOL,
]);

export function primaryCode(error) {
  return typeof error?.errcode === "number" ? error.errcode & 0xff : null;
}

/**
 * 例外を AppError へ変換する。分類できないもの（アプリの不具合）は INTERNAL_ERROR にする。
 * 既に AppError なら（検証で投げたものなど）そのまま返す。
 */
export function classifySqliteError(error) {
  if (error instanceof AppError) return error;
  const code = primaryCode(error);
  if (CORRUPT_CODES.has(code))
    return new AppError("DATA_CORRUPT", { detail: `sqlite ${error.errstr}`, cause: error });
  if (STORAGE_CODES.has(code))
    return new AppError("STORAGE_FAILURE", { detail: `sqlite ${error.errstr}`, cause: error });
  return new AppError("INTERNAL_ERROR", { detail: "unexpected storage error", cause: error });
}
