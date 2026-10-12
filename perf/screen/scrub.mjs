// 結果ファイルに書く値の検証・正規化。計測値の大半は、ブラウザ・Lighthouse・測定対象の応答に由来する（外部の入力）。
// 書く前に、数値は有限の数だけ、文字列は表示できる文字（ASCII の印字文字・日本語）と長さ（200 字まで）だけ（制御文字を除く）、キーは許可した形だけに絞る
// （CodeQL js/http-to-file-access の是正。保存するのは数値と短い識別子だけで、応答の文字列をそのまま書かない）。
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
