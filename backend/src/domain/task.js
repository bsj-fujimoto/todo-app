// タスクの形と、保存済みの行の検証（純粋関数）。
// 保存データが契約（title 1〜100 コードポイント・改行なし・前後空白なし、createdAt は UTC ISO 8601 等）に
// 沿っているかを確かめ、沿っていなければ DATA_CORRUPT として扱うための材料を返す。
import { validateTitle } from "./title.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 並び替えが文字列比較（ORDER BY created_at）で成り立つよう、ミリ秒精度・Z 付きの固定形式だけを正とする。
const CREATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isCanonicalIsoUtc(value) {
  if (typeof value !== "string" || !CREATED_AT_PATTERN.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isStoredTitle(value) {
  if (typeof value !== "string") return false;
  const result = validateTitle(value);
  return result.ok && result.title === value;
}

/** 行（SQLite の列名）の問題のある列名を返す。問題なしなら null。値そのものは返さない（利用者データを出さない）。 */
export function findInvalidColumn(row) {
  if (!isUuid(row.id)) return "id";
  if (!isStoredTitle(row.title)) return "title";
  if (row.completed !== 0 && row.completed !== 1) return "completed";
  if (!isCanonicalIsoUtc(row.created_at)) return "created_at";
  return null;
}

/** 検証済みの行を API の Task（契約の Task スキーマ）へ変換する。 */
export function rowToTask(row) {
  return { id: row.id, title: row.title, completed: row.completed === 1, createdAt: row.created_at };
}
