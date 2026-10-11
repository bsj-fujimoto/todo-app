// エラーコード → 利用者向け文言。仕様書 §04 / backend/openapi.yaml の文言と完全一致させる。
export const MESSAGES = Object.freeze({
  TITLE_REQUIRED: "タスク名を入力してください",
  TITLE_TOO_LONG: "タスク名は100文字以内で入力してください",
  TITLE_MULTILINE: "タスク名は1行で入力してください",
  STORAGE_FAILURE: "保存できませんでした。もう一度お試しください",
  DATA_CORRUPT: "保存データを読み込めませんでした",
});

export const EMPTY_MESSAGE = "タスクはありません";
export const LOADING_MESSAGE = "読み込み中…";
export const RETRY_LABEL = "再読み込み";

/** 入力欄の直下に出す検証エラーのコードか。 */
export function isTitleErrorCode(code) {
  return code === "TITLE_REQUIRED" || code === "TITLE_TOO_LONG" || code === "TITLE_MULTILINE";
}

/** コード → 文言。未知のコードは保存失敗の文言にする。 */
export function messageFor(code) {
  return MESSAGES[code] ?? MESSAGES.STORAGE_FAILURE;
}
