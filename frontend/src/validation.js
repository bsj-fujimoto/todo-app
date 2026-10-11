// タイトルの検証。backend と同一規則の純粋関数（検証順: 前後空白除去 → 必須 → 長さ → 改行。UNK-001）。
export const TITLE_MAX_LENGTH = 100;

/** Unicode コードポイント数（UTF-16 の length ではない）。 */
export function countCodePoints(text) {
  return [...text].length;
}

/**
 * @param {unknown} raw 検証前の生の入力
 * @returns {{ ok: true, title: string } | { ok: false, code: "TITLE_REQUIRED" | "TITLE_TOO_LONG" | "TITLE_MULTILINE" }}
 */
export function validateTitle(raw) {
  const title = typeof raw === "string" ? raw.trim() : "";
  if (title.length === 0) return { ok: false, code: "TITLE_REQUIRED" };
  if (countCodePoints(title) > TITLE_MAX_LENGTH) return { ok: false, code: "TITLE_TOO_LONG" };
  if (/[\r\n]/.test(title)) return { ok: false, code: "TITLE_MULTILINE" };
  return { ok: true, title };
}
