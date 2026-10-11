// k6 共通部品。k6 は Go 製ランタイムで DI できないため、時刻・乱数に関する lint 規約の例外として
// eslint.config.js で perf/k6/** を許可している（乱数は使わず、操作の選択は決定的な表で行う）。
import http from "k6/http";
import exec from "k6/execution";
import { check } from "k6";

export const BASE_URL = __ENV.BASE_URL || "http://frontend:8080";
export const API = `${BASE_URL}/api/v1`;
const JSON_HEADERS = { "Content-Type": "application/json" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function envInt(name, fallback) {
  const v = __ENV[name];
  return v === undefined || v === "" ? fallback : parseInt(v, 10);
}

export function loadSlo() {
  return JSON.parse(__ENV.SLO_JSON || "{}");
}

// 全試験共通の threshold。SLO（perf/slo.yaml）から run.sh が SLO_JSON として渡す。
// 合否の正本は scripts/perf/verdict.mjs。ここは実行中に分かる早期警告（abortOnFail は使わない）。
export function sloThresholds(slo) {
  const t = {
    http_req_failed: [`rate<${slo.error_rate ?? 0.01}`],
    checks: ["rate>0.99"],
  };
  const dur = {
    list: slo.api_list_p95_ms,
    create: slo.api_create_p95_ms,
    toggle: slo.api_update_p95_ms,
    delete: slo.api_delete_p95_ms,
  };
  for (const [endpoint, ms] of Object.entries(dur)) {
    t[`http_req_duration{endpoint:${endpoint}}`] = [`p(95)<=${ms ?? 1000}`];
  }
  return t;
}

export const SUMMARY_TREND_STATS = [
  "avg",
  "min",
  "med",
  "max",
  "p(90)",
  "p(95)",
  "p(99)",
  "p(99.9)",
  "count",
];

// ---- 操作の選択（決定的）。mix の比率どおりの 20 スロット表を、互いに素な歩幅で巡回する
const SLOTS = 20;
const STRIDE = 7;
function table(mix) {
  const order = ["list", "create", "toggle", "delete"];
  const out = [];
  for (const op of order) {
    const n = Math.round((mix[op] ?? 0) * SLOTS);
    for (let i = 0; i < n; i += 1) out.push(op);
  }
  return out;
}
export const MIXES = {
  model: table({ list: 0.6, create: 0.25, toggle: 0.1, delete: 0.05 }),
  balanced: table({ list: 0.6, create: 0.15, toggle: 0.1, delete: 0.15 }),
};

export function pickOp(mixName) {
  const t = MIXES[mixName] || MIXES.model;
  const i = exec.scenario.iterationInTest;
  return t[(i * STRIDE) % SLOTS];
}

// ---- 応答検証（openapi.yaml の契約の主要項目）
function isIsoDate(v) {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

export function isTask(t) {
  if (t === null || typeof t !== "object" || Object.keys(t).length !== 4) return false;
  return (
    UUID_RE.test(t.id) &&
    typeof t.title === "string" &&
    t.title.length > 0 &&
    typeof t.completed === "boolean" &&
    isIsoDate(t.createdAt)
  );
}

// 本文が JSON でなければ null（応答検証の check 側で失敗にする）
function safeJson(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

// 本文のある要求（POST / PATCH）だけ Content-Type: application/json を付ける。
// 本文の無い GET / DELETE に付けると Fastify が 400（空の JSON 本文）を返す。実際のブラウザも付けない。
function tagged(endpoint, expected, extra, hasBody) {
  return {
    tags: { endpoint, ...(extra || {}) },
    headers: hasBody ? JSON_HEADERS : {},
    responseCallback: http.expectedStatuses(expected),
  };
}

export function listTasks(minCount, extra) {
  const res = http.get(`${API}/tasks`, tagged("list", 200, extra));
  const body = safeJson(res);
  const tasks = body && Array.isArray(body.tasks) ? body.tasks : null;
  check(
    res,
    {
      "list: status 200": (r) => r.status === 200,
      "list: tasks は配列で件数が想定以上": () => tasks !== null && tasks.length >= minCount,
      "list: 先頭の Task が契約どおり": () => tasks !== null && tasks.length > 0 && isTask(tasks[0]),
      "list: createdAt の降順": () =>
        tasks !== null && (tasks.length < 2 || tasks[0].createdAt >= tasks[1].createdAt),
    },
    { endpoint: "list" },
  );
  return tasks;
}

export function createTask(title, extra) {
  const res = http.post(`${API}/tasks`, JSON.stringify({ title }), tagged("create", 201, extra, true));
  const task = safeJson(res);
  check(
    res,
    {
      "create: status 201": (r) => r.status === 201,
      "create: Task が契約どおりで completed=false": () =>
        isTask(task) && task.completed === false && task.title === title,
    },
    { endpoint: "create" },
  );
  return res.status === 201 && isTask(task) ? task : null;
}

export function toggleTask(id, completed, extra) {
  const res = http.patch(
    `${API}/tasks/${id}`,
    JSON.stringify({ completed }),
    tagged("toggle", 200, extra, true),
  );
  const task = safeJson(res);
  check(
    res,
    {
      "toggle: status 200": (r) => r.status === 200,
      "toggle: completed が反映され id が一致": () =>
        isTask(task) && task.completed === completed && task.id === id,
    },
    { endpoint: "toggle" },
  );
  return res.status === 200;
}

export function deleteTask(id, extra) {
  const res = http.del(`${API}/tasks/${id}`, null, tagged("delete", 204, extra));
  check(res, { "delete: status 204": (r) => r.status === 204 }, { endpoint: "delete" });
  return res.status === 204;
}

// ---- VU ごとの作成済み ID プール（toggle / delete の対象。他 VU と競合しない）
const pool = [];
let toggled = false;

function createIntoPool(extra) {
  const t = createTask(`性能確認-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`, extra);
  if (t) pool.push(t.id);
}

function toggleFromPool(extra) {
  toggled = !toggled;
  toggleTask(pool[pool.length - 1], toggled, extra);
}

function deleteFromPool(extra) {
  // 削除の対象が無いときは、作ってすぐ削除する（件数を増やさない）。単に create に置き換えると追加が多くなり、
  // 追加=削除のはずの比率（balanced）でも件数が増え続け、「時間による劣化」と「件数による劣化」を分けられない
  if (pool.length === 0) createIntoPool(extra);
  const id = pool.pop();
  if (id !== undefined) deleteTask(id, extra);
}

export function runOp(mixName, minListCount, extra) {
  let op = pickOp(mixName);
  if (op === "toggle" && pool.length === 0) op = "create";
  if (op === "list") listTasks(minListCount, extra);
  else if (op === "create") createIntoPool(extra);
  else if (op === "toggle") toggleFromPool(extra);
  else deleteFromPool(extra);
  return op;
}

// ---- DS-006 の投入（API 経由）。偶数番は完了済みにする
export function seedTasks(count, startIndex) {
  const first = startIndex || 1;
  for (let n = first; n < first + count; n += 1) {
    const title = `タスク-${String(n).padStart(4, "0")}`;
    const t = createTask(title, { phase: "seed" });
    if (t && n % 2 === 0) toggleTask(t.id, true, { phase: "seed" });
  }
}

export function countTasks() {
  const res = http.get(`${API}/tasks`, tagged("list", 200, { phase: "seed" }));
  return res.status === 200 ? res.json().tasks.length : -1;
}

// 実行の窓（観測サンプラーとの時刻整合用）。終了時刻と所要時間から開始時刻を逆算する
export function windowInfo(data) {
  const endMs = Date.now();
  const dur = data.state.testRunDurationMs;
  return { start_ms: Math.round(endMs - dur), end_ms: endMs, duration_ms: Math.round(dur) };
}

export function buildSummary(name, data, extraOut) {
  const out = {
    scenario: name,
    window: windowInfo(data),
    options: { thresholds: data.options.thresholds, scenarios: data.options.scenarios },
    env: { BASE_URL, MIX: __ENV.MIX || null, ...(extraOut || {}) },
    metrics: data.metrics,
    root_group: data.root_group,
  };
  const dir = __ENV.OUT_DIR || "/out";
  const failed = Object.entries(data.metrics)
    .filter(([, m]) => m.thresholds && Object.values(m.thresholds).some((t) => t.ok === false))
    .map(([k]) => k);
  const line = `[k6:${name}] iterations=${data.metrics.iterations ? data.metrics.iterations.values.count : 0} threshold_violations=${failed.length ? failed.join(",") : "none"}\n`;
  const file = `${dir}/${__ENV.SUMMARY_NAME || "main"}.summary.json`;
  return { [file]: JSON.stringify(out, null, 1), stdout: line };
}
