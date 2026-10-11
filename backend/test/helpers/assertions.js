// 複数のテストで使うアサーション。
import assert from "node:assert/strict";

export const MESSAGES = Object.freeze({
  TITLE_REQUIRED: "タスク名を入力してください",
  TITLE_TOO_LONG: "タスク名は100文字以内で入力してください",
  TITLE_MULTILINE: "タスク名は1行で入力してください",
  STORAGE_FAILURE: "保存できませんでした。もう一度お試しください",
  DATA_CORRUPT: "保存データを読み込めませんでした",
});

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** {error: {code, message}} の封筒で、status と code が期待どおり、message は空でない文字列（期待文言があれば一致）。 */
export function assertError(response, status, code, message) {
  assert.equal(response.status, status, `status: ${response.text}`);
  assert.deepEqual(Object.keys(response.body), ["error"]);
  assert.deepEqual(Object.keys(response.body.error).sort(), ["code", "message"]);
  assert.equal(response.body.error.code, code);
  assert.equal(typeof response.body.error.message, "string");
  assert.notEqual(response.body.error.message, "");
  if (message !== undefined) assert.equal(response.body.error.message, message);
}

/** 文言まで仕様書どおりであることを確かめる（MESSAGES にあるコード用）。 */
export function assertSpecError(response, status, code) {
  assertError(response, status, code, MESSAGES[code]);
}

export function titlesOf(response) {
  assert.equal(response.status, 200, response.text);
  return response.body.tasks.map((task) => task.title);
}

/** DB の行（readRows の結果）から、操作対象以外の行だけを取り出す。 */
export function without(rows, id) {
  return rows.filter((row) => row.id !== id);
}
