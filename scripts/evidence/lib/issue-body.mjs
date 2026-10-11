// 不具合 Issue の本文（.github/ISSUE_TEMPLATE/defect.md の見出し）を読む。純粋関数。
// 見出し: 識別 / 再現手順 / 期待結果 / 実際の結果 / 影響 / 関連ケース / 証拠 / 原因分類（判明後に記入）。

/** "## 見出し" ごとの本文。見出しの括弧書き（「（判明後に記入）」など）は落とす。 */
export function parseSections(body) {
  const sections = new Map();
  let current = null;
  for (const line of String(body ?? "").split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      current = m[1].replace(/（.*$/, "").trim();
      sections.set(current, []);
    } else if (current) sections.get(current).push(line);
  }
  return new Map([...sections].map(([k, lines]) => [k, lines.join("\n").trim()]));
}

const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";

/**
 * HTML コメント（<!-- … -->）を取り除く。出力は HTML として使わず、コメントを捨てるだけだが、
 * 取り除いた結果に開始記号が残らないよう、残らなくなるまで繰り返す（閉じていないコメントは末尾まで捨てる）。
 */
export function stripHtmlComments(text) {
  let current = String(text ?? "");
  while (current.includes(COMMENT_OPEN)) {
    const start = current.indexOf(COMMENT_OPEN);
    const end = current.indexOf(COMMENT_CLOSE, start + COMMENT_OPEN.length);
    current =
      end < 0 ? current.slice(0, start) : current.slice(0, start) + current.slice(end + COMMENT_CLOSE.length);
  }
  return current;
}

/** "- キー: 値" の箇条書き。値が次の行に続くとき（箇条書きでない行）は連結する。HTML コメントは捨てる。 */
export function parseBullets(text) {
  const out = new Map();
  let key = null;
  for (const raw of stripHtmlComments(text).split(/\r?\n/)) {
    const m = /^-\s+([^:：]+)[:：]\s*(.*)$/.exec(raw);
    if (m) {
      key = m[1].trim();
      out.set(key, m[2].trim());
    } else if (key && raw.trim() && !/^\s*-\s/.test(raw))
      out.set(key, `${out.get(key)} ${raw.trim()}`.trim());
  }
  return out;
}

/** 手順・箇条書き・段落を 1 行にまとめる（番号・記号は残す。コメントは捨てる）。 */
export function oneLine(text) {
  return stripHtmlComments(text)
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .join(" / ");
}

/** 値の先頭の語（「implementation（backend の…）。…」→ implementation）。区切りは括弧・読点・空白・スラッシュ。 */
export const firstWord = (value) =>
  String(value ?? "")
    .split(/[（(。、,\s/]/)[0]
    .trim()
    .toLowerCase();

/** 値の括弧書きより前にある語のうち、語彙に含まれるもの（出現順。説明文の中の英単語は拾わない）。 */
export const wordsIn = (value, vocabulary) =>
  String(value ?? "")
    .split(/[（(]/)[0]
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => vocabulary.includes(w));
