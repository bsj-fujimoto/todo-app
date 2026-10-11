// k6 の生出力（--out json=<file>[.gz]。1 行 1 JSON）を読み、判定に必要な点だけ集める。
// 時刻・乱数は使わない。入出力は引数のファイルパスだけ。
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

const EXCLUDED_PHASES = new Set(["seed", "warmup"]);
const KEEP_TAGS = ["endpoint", "stage", "phase", "bucket", "tasks", "status"];

function pickTags(tags) {
  const out = {};
  for (const k of KEEP_TAGS) if (tags[k] !== undefined) out[k] = tags[k];
  return out;
}

function emptyCollected() {
  return { durations: [], failed: [], checks: [], iterations: 0, dropped: 0, firstMs: null, lastMs: null };
}

function track(c, ms) {
  if (c.firstMs === null || ms < c.firstMs) c.firstMs = ms;
  if (c.lastMs === null || ms > c.lastMs) c.lastMs = ms;
}

// 1 点を collected に反映する。判定対象外（seed / warm-up のタグ）の点は捨てる
export function absorbPoint(c, metric, data) {
  const tags = data.tags || {};
  if (EXCLUDED_PHASES.has(tags.phase)) return;
  const ms = Date.parse(data.time);
  if (metric === "http_req_duration") {
    c.durations.push({ ms, v: data.value, ...pickTags(tags) });
    track(c, ms);
  } else if (metric === "http_req_failed") {
    c.failed.push({ ms, v: data.value, ...pickTags(tags) });
  } else if (metric === "checks") {
    c.checks.push({ ms, v: data.value, check: tags.check, ...pickTags(tags) });
  } else if (metric === "iterations") {
    c.iterations += 1;
  } else if (metric === "dropped_iterations") {
    c.dropped += data.value;
  }
}

export function absorbLine(c, line) {
  if (!line) return;
  const rec = JSON.parse(line);
  if (rec.type === "Point") absorbPoint(c, rec.metric, rec.data);
}

export async function readK6Raw(path) {
  const c = emptyCollected();
  const src = createReadStream(path);
  const stream = path.endsWith(".gz") ? src.pipe(createGunzip()) : src;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) absorbLine(c, line);
  return c;
}
