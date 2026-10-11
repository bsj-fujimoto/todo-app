// JUnit XML（node:test の junit reporter / Playwright の junit reporter）を依存ゼロで読む。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ENTITIES = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'" };
const TC_ID = /\[(TC-\d{3})\]/g;

export function decode(text) {
  return text
    .replace(/&(lt|gt|amp|quot|apos);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function attrs(text) {
  const out = {};
  for (const m of text.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

function statusOf(body) {
  if (/<(failure|error)\b/.test(body)) return "failed";
  if (/<skipped\b/.test(body)) return "skipped";
  return "passed";
}

export function tcIdsOf(name) {
  return [...new Set([...String(name).matchAll(TC_ID)].map((m) => m[1]))];
}

// node:test（プロセス分離）は、テストファイル 1 つにつき「ファイル名の testcase」を親として出す。
// 成功したものは中身のテストと二重になるので数えない。失敗したもの（起動失敗・構文エラーなど）は失敗として残す。
const isFileEntry = (c) => c.classname === "test" && /\.test\.[cm]?[jt]s$/.test(c.name);

const toCase = (a, body, source) => ({
  name: a.name || "",
  classname: a.classname || "",
  file: a.file || "",
  time: Number(a.time) || 0,
  status: statusOf(body),
  source,
});

/** 1 つの JUnit XML 文字列 → テストケース配列（入れ子の testsuite を平らにする）。 */
export function parseJunit(xml, source = "") {
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  const cases = [...xml.matchAll(re)].map((m) => toCase(attrs(m[1]), m[2] || "", source));
  return cases.filter((c) => !(isFileEntry(c) && c.status === "passed"));
}

export function listXmlFiles(path) {
  const st = statSync(path, { throwIfNoEntry: false });
  if (!st) return [];
  if (st.isFile()) return path.endsWith(".xml") ? [path] : [];
  return readdirSync(path, { withFileTypes: true }).flatMap((e) => listXmlFiles(join(path, e.name)));
}

export function readJunitFiles(paths) {
  const files = paths.flatMap(listXmlFiles).sort();
  return { files, cases: files.flatMap((f) => parseJunit(readFileSync(f, "utf8"), f)) };
}

/** テストケースの所属レイヤー。パスで分かればそれを使い、分からなければ呼び出し側の既定値。 */
export function layerOf(tc, fallback) {
  const hay = `${tc.file} ${tc.classname} ${tc.source}`.replaceAll("\\", "/");
  if (/(^|\/)contract\.xml$/.test(tc.source.replaceAll("\\", "/"))) return "contract";
  if (/\/compose\/|stack\.spec/.test(hay)) return "compose";
  if (/\/test\/api\//.test(hay)) return "api";
  if (/\/test\/unit\//.test(hay)) return "unit";
  return fallback;
}

export function countBy(cases) {
  const c = { total: cases.length, passed: 0, failed: 0, skipped: 0, retried_success: 0, duration_sec: 0 };
  const attempts = new Map();
  for (const tc of cases) {
    c[tc.status] += 1;
    c.duration_sec += tc.time;
    const key = `${tc.classname}\u0000${tc.name}`;
    attempts.set(key, [...(attempts.get(key) ?? []), tc.status]);
  }
  for (const list of attempts.values()) {
    if (list.includes("failed") && list.at(-1) === "passed") c.retried_success += 1;
  }
  c.duration_sec = Math.round(c.duration_sec * 1000) / 1000;
  return c;
}
