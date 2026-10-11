// エラーコードと HTTP 写像。文言は仕様書・backend/openapi.yaml の通り（利用者向けの日本語）。
// 契約の Error.code 列挙と一致させる（test/api/contract.test.js が突き合わせる）。

export const ERROR_DEFS = Object.freeze({
  TITLE_REQUIRED: { status: 422, message: "タスク名を入力してください" },
  TITLE_TOO_LONG: { status: 422, message: "タスク名は100文字以内で入力してください" },
  TITLE_MULTILINE: { status: 422, message: "タスク名は1行で入力してください" },
  INVALID_REQUEST: { status: 400, message: "リクエストの形式が正しくありません" },
  TASK_NOT_FOUND: { status: 404, message: "タスクが見つかりません" },
  STORAGE_FAILURE: { status: 503, message: "保存できませんでした。もう一度お試しください" },
  DATA_CORRUPT: { status: 500, message: "保存データを読み込めませんでした" },
  // 契約への非破壊の追加（想定外の障害・未定義のルート）
  INTERNAL_ERROR: { status: 500, message: "サーバーでエラーが発生しました" },
  ROUTE_NOT_FOUND: { status: 404, message: "指定されたパスは存在しません" },
});

/** error レベルでログに出す（原因調査が必要な）コード。利用者の入力ミスは含めない。 */
export const SERVER_SIDE_CODES = Object.freeze(["STORAGE_FAILURE", "DATA_CORRUPT", "INTERNAL_ERROR"]);

/**
 * アプリケーション内で投げるエラー。code は ERROR_DEFS のキー。
 * detail はログ用の短い説明（利用者データを含めない）、cause は元の例外。
 */
export class AppError extends Error {
  constructor(code, { detail, cause } = {}) {
    super(detail ?? code, { cause });
    this.name = "AppError";
    this.code = code;
    this.detail = detail;
  }
}

/** エラー封筒（契約の Error スキーマ）を作る。 */
export function errorBody(code) {
  return { error: { code, message: ERROR_DEFS[code].message } };
}

export function statusOf(code) {
  return ERROR_DEFS[code].status;
}
