// テストが「実際に観察した値」を残す共有の道具（実施表 docs/data/executions.csv の actual_result と、証拠台帳の材料）。
// 期待結果の転記ではなく、実行中に見た画面・API 応答・計測値だけを書く。利用者データは合成データのみ。
// 書き出し先: <workspace>/test-results/observations/<TC-ID>[.<project>].json（同じ TC の複数テストは entries に並ぶ）。
// 時刻は注入できる（既定は wallClock）。生成側（scripts/evidence/build-executions.mjs）が読む。
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OBSERVATION_SCHEMA = 1;

/** 観察値のサイズ上限。証跡は小さく保つ（行数・文字数・呼び出し数）。 */
export const LIMITS = Object.freeze({
  rows: 10,
  titleChars: 40,
  messageChars: 80,
  calls: 30,
  notes: 20,
  noteChars: 160,
  bodyChars: 120,
  tableRows: 12,
});

/** 観察値の書き出し先（リポジトリ直下の <component>/test-results/observations）。component: backend / frontend / e2e */
export const observationsDir = (component) =>
  fileURLToPath(new URL(`../../${component}/test-results/observations`, import.meta.url));

const TC_ID = /\[(TC-\d{3})\]/g;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * 文字数（コードポイント）で切り、切ったら元の長さを残す。UUID は {uuid} に伏せる
 * （採番された識別子は証拠として意味が無く、0 が並ぶ UUID は電話番号の検査（qc-analyzer・check-evidence）に誤検出されるため）。
 */
export function clip(value, max) {
  const chars = [...String(value ?? "").replace(UUID, "{uuid}")];
  return chars.length > max ? `${chars.slice(0, max).join("")}…(${chars.length}文字)` : chars.join("");
}

export const tcIdsOf = (name) => [...new Set([...String(name).matchAll(TC_ID)].map((m) => m[1]))];

/** 実時刻（ISO 8601 UTC）。Date を直接作らず performance の原点から求める（テスト支援は clock を注入できる）。 */
export function wallClock() {
  return new Date(performance.timeOrigin + performance.now()).toISOString();
}

/** CI の run に紐づける情報。ローカルでは local。 */
export function runInfo(env = process.env) {
  const pick = (key, fallback) => env[key] || fallback;
  return {
    commit_sha: env.TARGET_SHA || pick("GITHUB_SHA", "local"),
    run_id: pick("GITHUB_RUN_ID", "local"),
    run_attempt: pick("GITHUB_RUN_ATTEMPT", "1"),
    repository: pick("GITHUB_REPOSITORY", null),
    workflow: pick("GITHUB_WORKFLOW", null),
    event: pick("GITHUB_EVENT_NAME", null),
  };
}

/** 実施環境（OS・Node 版。ブラウザは呼び出し側が足す）。 */
export function hostEnvironment(extra = {}) {
  return {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    ...extra,
  };
}

/** API 呼び出し 1 件の要約（method path → status と、応答の主要な値）。大きな本文は長さだけ残す。 */
export function summarizeBody(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 2000 ? `(${text.length} バイト)` : clip(text, LIMITS.bodyChars);
}

export function summarizeCall({ method, path: callPath, status, request, response }) {
  return {
    method,
    path: clip(callPath, 80),
    status,
    request: summarizeBody(request),
    response: summarizeBody(response),
  };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** mkdir の排他でロックを取る（並列のテストプロセス・worker が同じ TC のファイルへ書くため）。 */
function withLock(lockDir, action) {
  let waited = 0;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      if (waited >= 5000) rmSync(lockDir, { recursive: true, force: true });
      sleepSync(10);
      waited += 10;
    }
  }
  try {
    return action();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function readEntries(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8")).entries ?? [];
  } catch {
    return [];
  }
}

/** <dir>/<name>.json に entry を足す（同じ title・layer の entry は置き換える＝再実行しても増えない）。 */
export function mergeEntry({ dir, name, tcId, entry }) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  withLock(`${file}.lock`, () => {
    const others = readEntries(file).filter((e) => !(e.title === entry.title && e.layer === entry.layer));
    const body = { schema_version: OBSERVATION_SCHEMA, test_case_id: tcId, entries: [...others, entry] };
    writeFileSync(`${file}.tmp`, `${JSON.stringify(body, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  });
  return file;
}

/** テストごとの観察の入れ物。note は自由記述の実測、table は入力→結果の実測表。 */
export function createObservations({ layer, component, project = null, clock = wallClock } = {}) {
  const state = { calls: [], notes: [], table: [], startedAt: clock() };
  const finishers = [];
  return {
    layer,
    component,
    project,
    state,
    call: (call) => state.calls.push(summarizeCall(call)),
    note: (label, value) => {
      const shown = typeof value === "string" ? value : JSON.stringify(value);
      state.notes.push({ label: clip(label, 60), value: clip(shown, LIMITS.noteChars) });
    },
    /** 同じ label の note を置き換える（最後に見た値だけを残したいとき）。 */
    set: (label, value) => {
      const shown = typeof value === "string" ? value : JSON.stringify(value);
      const entry = { label: clip(label, 60), value: clip(shown, LIMITS.noteChars) };
      const index = state.notes.findIndex((n) => n.label === entry.label);
      if (index >= 0) state.notes[index] = entry;
      else state.notes.push(entry);
    },
    row: (input, result) => {
      const show = (v) => clip(typeof v === "string" ? v : JSON.stringify(v), LIMITS.noteChars);
      state.table.push({ input: show(input), result: show(result) });
    },
    /** テスト終了時（書き出しの直前）に呼ぶ関数を登録する。終了時点の画面・状態を見るために使う。 */
    onFinish: (fn) => finishers.push(fn),
    finish: () => finishers.splice(0).forEach((fn) => fn()),
    reset: () => {
      finishers.length = 0;
      Object.assign(state, { calls: [], notes: [], table: [], startedAt: clock() });
    },
  };
}

const capped = (list, max) => ({ items: list.slice(0, max), omitted: Math.max(0, list.length - max) });

/** 観察の入れ物 → 書き出す entry（上限を適用し、実施環境・run を付ける）。 */
export function buildEntry({ obs, title, outcome, durationMs, extra = {}, clock = wallClock }) {
  const finishedAt = clock();
  const calls = capped(obs.state.calls, LIMITS.calls);
  const notes = capped(obs.state.notes, LIMITS.notes);
  const table = capped(obs.state.table, LIMITS.tableRows);
  return {
    title: clip(title, 200),
    test_case_ids: tcIdsOf(title),
    layer: obs.layer,
    component: obs.component,
    project: obs.project,
    outcome,
    started_at: obs.state.startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs ?? Math.max(0, Date.parse(finishedAt) - Date.parse(obs.state.startedAt)),
    run: runInfo(),
    environment: hostEnvironment(extra.environment),
    ...(extra.screen ? { screen: extra.screen } : {}),
    api_calls: calls.items,
    api_calls_omitted: calls.omitted,
    notes: notes.items,
    table: table.items,
    table_omitted: table.omitted,
  };
}

/** entry を、タイトルに含まれる TC-ID すべてのファイルへ書く。TC-ID が無いテストは書かない。 */
export function writeEntry({ dir, entry, nameFor }) {
  return entry.test_case_ids.map((tcId) => mergeEntry({ dir, name: nameFor(tcId), tcId, entry }));
}

/** 入力文字列の短い表示（長いものは先頭とコードポイント数）。実測表の「入力」列に使う。 */
export function describeText(value, max = 24) {
  if (typeof value !== "string") return JSON.stringify(value) ?? String(value);
  const chars = [...value];
  return chars.length > max
    ? `${JSON.stringify(chars.slice(0, 12).join(""))}…(${chars.length}コードポイント)`
    : JSON.stringify(value);
}

/** 検証関数の戻り値の短い表示（合格なら保存用 title、不合格ならコード）。実測表の「結果」列に使う。 */
export function describeValidation(result) {
  if (result?.ok) return `合格 title=${describeText(result.title)}`;
  return `不合格 ${result?.code ?? "(コードなし)"}`;
}
