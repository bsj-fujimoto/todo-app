// 応答の検証（assertions / expect）。純関数。失敗は文字列（利用者向けの失敗詳細）で返し、成功は null。
// res = { status, headers（小文字キー）, bodyText, json（JSON でなければ undefined）, durationMs }
import { interpolate, jsonPath } from "./vars.mjs";
import { validateNamed } from "./schema.mjs";

const show = (v) =>
  typeof v === "string" ? JSON.stringify(v.length > 80 ? `${v.slice(0, 80)}…` : v) : JSON.stringify(v);

function checkStatus(expected, res) {
  return res.status === expected ? null : `status が ${res.status}（期待 ${expected}）`;
}

function checkHeader(spec, res) {
  const value = res.headers[spec.name.toLowerCase()];
  if (spec.present && value === undefined) return `ヘッダ ${spec.name} が無い`;
  if (spec.matches && !new RegExp(spec.matches).test(value || ""))
    return `ヘッダ ${spec.name} が ${spec.matches} に一致しない`;
  return null;
}

function checkBodyContains(text, res) {
  return res.bodyText.includes(text) ? null : `本文に ${show(text)} が無い`;
}

function checkBodyNotContains(text, res) {
  return res.bodyText.includes(text) ? `本文に ${show(text)} が含まれる` : null;
}

function checkJson(spec, res) {
  if (res.json === undefined) return "本文が JSON でない";
  if (spec.when_set && (spec.equals === "" || spec.equals === undefined)) return null;
  const actual = jsonPath(res.json, spec.path);
  return actual === spec.equals ? null : `${spec.path} が ${show(actual)}（期待 ${show(spec.equals)}）`;
}

function findItem(spec, res) {
  const list = res.json === undefined ? undefined : jsonPath(res.json, spec.path);
  if (!Array.isArray(list)) return { list: null, item: undefined };
  return { list, item: list.find((x) => x && x[spec.key] === spec.value) };
}

function checkArrayContains(spec, res) {
  const { list, item } = findItem(spec, res);
  if (list === null) return `${spec.path} が配列でない`;
  return item ? null : `${spec.path} に ${spec.key}=${show(spec.value)} の要素が無い（永続化されていない）`;
}

function checkArrayNotContains(spec, res) {
  const { list, item } = findItem(spec, res);
  if (list === null) return `${spec.path} が配列でない`;
  return item
    ? `${spec.path} に ${spec.key}=${show(spec.value)} の要素が残っている（削除されていない）`
    : null;
}

function checkArrayItemEquals(spec, res) {
  const { list, item } = findItem(spec, res);
  if (list === null) return `${spec.path} が配列でない`;
  if (!item) return `${spec.path} に ${spec.key}=${show(spec.value)} の要素が無い`;
  return item[spec.field] === spec.equals
    ? null
    : `${spec.field} が ${show(item[spec.field])}（期待 ${show(spec.equals)}）`;
}

function checkSchema(name, res, ctx) {
  if (res.json === undefined) return `本文が JSON でなく ${name} を検証できない`;
  const errors = validateNamed(name, res.json, ctx.openapi);
  return errors.length ? `契約違反（${name}）: ${errors.slice(0, 3).join(" / ")}` : null;
}

function checkLatency(max, res) {
  return res.durationMs <= max ? null : `応答 ${Math.round(res.durationMs)}ms > ${max}ms`;
}

const CHECKS = {
  status: (v, res) => checkStatus(v, res),
  header: (v, res) => checkHeader(v, res),
  body_contains: (v, res) => checkBodyContains(v, res),
  body_not_contains: (v, res) => checkBodyNotContains(v, res),
  json: (v, res) => checkJson(v, res),
  schema: (v, res, ctx) => checkSchema(v, res, ctx),
  array_contains: (v, res) => checkArrayContains(v, res),
  array_not_contains: (v, res) => checkArrayNotContains(v, res),
  array_item_equals: (v, res) => checkArrayItemEquals(v, res),
  latency_ms_max: (v, res) => checkLatency(v, res),
};

// 1 つの期待（{ status: 200 } など）を検証する。未知の種類は設定ミスとして失敗にする
export function evaluateOne(entry, res, ctx) {
  const [kind] = Object.keys(entry);
  const fn = CHECKS[kind];
  if (!fn) return `未知の検証: ${kind}`;
  return fn(interpolate(entry[kind], ctx.vars), res, ctx);
}

export function evaluateAll(entries, res, ctx) {
  // 同じ失敗（例: 本文が JSON でない）が何度も並ばないよう重複を除く
  return [...new Set(entries.map((e) => evaluateOne(e, res, ctx)).filter((f) => f !== null))];
}
