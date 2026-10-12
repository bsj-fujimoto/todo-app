// 結果ファイル（results.json）に書く値の検証・正規化。failure_detail などは、測定対象の応答に由来する文字列（外部の入力）。
// 書く前に、数値は有限の数だけ、文字列は表示できる文字（ASCII の印字文字・日本語）と長さ（200 字まで）だけ（制御文字を除く）、キーは許可した形だけに絞る
// （CodeQL js/http-to-file-access の是正。perf/screen/scrub.mjs と同じ方針。向こうは Docker イメージの中だけで動くので別ファイル）。
const KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const SAFE_CHAR = /[^\x20-\x7e\u3040-\u9fff\uff00-\uffef]/gu;
const SAFE_STRING = /^[\x20-\x7e\u3040-\u9fff\uff00-\uffef]{0,200}$/u;

export function scrubString(s) {
  if (SAFE_STRING.test(s)) return s;
  return s.replace(SAFE_CHAR, "?").slice(0, 200);
}

function scrubObject(value) {
  const out = {};
  for (const key of Object.keys(value)) if (KEY_RE.test(key)) out[key] = scrub(value[key]);
  return out;
}

export function scrub(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map(scrub);
  return typeof value === "object" ? scrubObject(value) : null;
}
