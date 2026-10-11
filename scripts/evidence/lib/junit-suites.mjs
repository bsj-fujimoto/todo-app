// JUnit XML → テストケース（結果・失敗メッセージ・所属 suite の hostname / timestamp つき）。
// scripts/ci/lib/junit.mjs は集計用で suite の属性を捨てるため、実施表向けにここで読み直す。
import { decode } from "../../ci/lib/junit.mjs";

const TC_ID = /\[(TC-\d{3})\]/g;
export const tcIdsOf = (name) => [...new Set([...String(name).matchAll(TC_ID)].map((m) => m[1]))];

function attrs(text) {
  const out = {};
  for (const m of text.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

function resultOf(body) {
  const failure = /<(failure|error)\b([^>]*?)(?:\/>|>)/.exec(body);
  if (failure) {
    const message = attrs(failure[2]).message ?? "";
    return { status: "failed", message: message.split("\n")[0].slice(0, 200) };
  }
  if (/<skipped\b/.test(body)) return { status: "skipped", message: "" };
  return { status: "passed", message: "" };
}

// testsuite の開始と testcase を文書順に走査する（入れ子の testsuite でも、直近の testsuite の属性を使う）。
const TOKEN_RE = /<testsuite\b([^>]*)>|<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;

const text = (value) => value ?? "";

const toCase = (a, body, suite, source) => ({
  name: text(a.name),
  classname: text(a.classname),
  file: text(a.file),
  time: Number(a.time) || 0,
  suite: text(suite.name),
  hostname: text(suite.hostname),
  timestamp: text(suite.timestamp),
  source,
  ...resultOf(text(body)),
});

const isFileEntry = (c) =>
  c.classname === "test" && /\.test\.[cm]?[jt]s$/.test(c.name) && c.status === "passed";

/**
 * JUnit XML 文字列 → ケース配列。node:test がファイル名だけの親 testcase（成功時）を出すので、
 * 二重に数えないよう捨てる（scripts/ci/lib/junit.mjs と同じ扱い）。
 */
export function parseJunitSuites(xml, source = "") {
  const cases = [];
  let suite = {};
  for (const m of xml.matchAll(TOKEN_RE)) {
    if (m[1] !== undefined) suite = attrs(m[1]);
    else cases.push(toCase(attrs(m[2]), m[3], suite, source));
  }
  return cases.filter((c) => !isFileEntry(c));
}
