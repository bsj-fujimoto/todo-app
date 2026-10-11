// リクエストの構造検査（契約の CreateTaskRequest / UpdateTaskRequest と、path の id）。
// 契約とずれたら test/api/contract.test.js が落ちる（スキーマは契約が正本）。
import { AppError } from "../errors.js";
import { isUuid } from "../domain/task.js";

function invalid(detail) {
  return new AppError("INVALID_REQUEST", { detail });
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 本文が {key: <type>} だけを持つオブジェクトであることを確かめ、その値を返す（未知のフィールドは拒否）。 */
function singleField(body, key, type) {
  if (!isPlainObject(body)) throw invalid("body must be an object");
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== key) throw invalid(`body must have exactly the field ${key}`);
  if (typeof body[key] !== type) throw invalid(`${key} must be a ${type}`);
  return body[key];
}

/** POST /tasks の本文 → 検証前の生の title。 */
export function parseCreateBody(body) {
  return singleField(body, "title", "string");
}

/** PATCH /tasks/:id の本文 → completed。 */
export function parseUpdateBody(body) {
  return singleField(body, "completed", "boolean");
}

/** path の id が UUID であること（形式が違えば 404 ではなく 400）。 */
export function parseId(id) {
  if (!isUuid(id)) throw invalid("id must be a UUID");
  return id;
}
