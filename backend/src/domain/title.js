// タイトル検証（純粋関数）。仕様書 §04、openapi.yaml の TitleInvalid。 （選択実行の確認用の一時変更。マージしない）
// 検証順: 必須 → 長さ → 改行（1 回の検証で返すエラーは 1 つだけ）。
import { ERROR_DEFS } from "../errors.js";

export const TITLE_MAX_CODE_POINTS = 100;

function failure(code) {
  return { ok: false, code, message: ERROR_DEFS[code].message };
}

/**
 * @param {string} raw 検証前の生の入力
 * @returns {{ok: true, title: string} | {ok: false, code: string, message: string}}
 *
 * 「前後の空白」は暫定で String.prototype.trim() の範囲（未決 UNK-006。決定したらここだけ差し替える）。
 * 文字数は Unicode コードポイント単位（結合文字・サロゲートペアを 1 文字に丸めない）。
 */
export function validateTitle(raw) {
  const title = typeof raw === "string" ? raw.trim() : "";
  if (title === "") return failure("TITLE_REQUIRED");
  if ([...title].length > TITLE_MAX_CODE_POINTS) return failure("TITLE_TOO_LONG");
  if (/[\n\r]/.test(title)) return failure("TITLE_MULTILINE");
  return { ok: true, title };
}
