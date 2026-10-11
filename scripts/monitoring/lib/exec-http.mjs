// http / api 監視の 1 回の試行。副作用（通信・時刻）は deps（fetchFn, now）として受け取る。
// 返り値: { ok, failure（失敗詳細）, durationMs, steps: [{ id, status, durationMs }] }
import { evaluateAll } from "./checks.mjs";
import { interpolate, jsonPath, unresolved } from "./vars.mjs";

export async function sendRequest(deps, ctx, req, signal) {
  const spec = interpolate(req, ctx.vars);
  const init = { method: spec.method, signal, headers: {} };
  if (spec.body !== undefined) {
    init.body = JSON.stringify(spec.body);
    init.headers["content-type"] = "application/json";
  }
  const t0 = deps.now();
  const res = await deps.fetchFn(`${ctx.baseUrl}${spec.path}`, init);
  const bodyText = await res.text();
  const durationMs = deps.now() - t0;
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = undefined;
  }
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    bodyText,
    json,
    durationMs,
  };
}

const describeError = (e) => `通信エラー: ${e.name === "TimeoutError" ? "タイムアウト" : e.message}`;

// http 監視: request を 1 回送り、assertions[].check を全部確かめる
export async function runHttpAttempt(monitor, deps, ctx) {
  const signal = AbortSignal.timeout(monitor.timeout_sec * 1000);
  try {
    const res = await sendRequest(deps, ctx, monitor.request, signal);
    const checks = monitor.assertions.map((a) => a.check).filter(Boolean);
    const failures = evaluateAll(checks, res, ctx);
    return {
      ok: failures.length === 0,
      failure: failures.join("; ") || null,
      durationMs: res.durationMs,
      steps: [{ id: "request", status: res.status, durationMs: res.durationMs }],
      json: res.json,
    };
  } catch (e) {
    return { ok: false, failure: describeError(e), durationMs: monitor.timeout_sec * 1000, steps: [] };
  }
}

function saveVars(step, res, vars) {
  for (const [name, path] of Object.entries(step.save || {})) vars[name] = jsonPath(res.json, path);
}

async function runStep(step, deps, ctx, signal) {
  const res = await sendRequest(deps, ctx, step.request, signal);
  const failures = evaluateAll(step.expect || [], res, ctx);
  if (failures.length === 0) saveVars(step, res, ctx.vars);
  return { res, failures };
}

// finally: ジャーニーが作ったデータを必ず消す。404 は削除済みとして許容。それ以外の失敗は後始末の失敗として返す
export async function runCleanup(monitor, deps, ctx) {
  const problems = [];
  for (const c of monitor.cleanup || []) {
    if (unresolved(interpolate(c.request, ctx.vars)).length) continue; // task_id が採れなかった = 作られていない
    try {
      const res = await sendRequest(deps, ctx, c.request, AbortSignal.timeout(10000));
      const okStatus = [204, ...(c.ignore_status || [])];
      if (!okStatus.includes(res.status)) problems.push(`後始末 ${c.request.method} が ${res.status}`);
    } catch (e) {
      problems.push(`後始末に失敗: ${describeError(e)}`);
    }
  }
  return problems;
}

// api 監視: steps を順に実行（最初の失敗で止める）。cleanup は成否に関わらず実行する
export async function runApiAttempt(monitor, deps, ctx) {
  const vars = { ...ctx.vars };
  const local = { ...ctx, vars };
  const signal = AbortSignal.timeout(monitor.timeout_sec * 1000);
  const steps = [];
  let failure = null;
  const t0 = deps.now();
  try {
    for (const step of monitor.steps) {
      const { res, failures } = await runStep(step, deps, local, signal);
      steps.push({ id: step.id, status: res.status, durationMs: Math.round(res.durationMs) });
      if (failures.length > 0) {
        failure = `step ${step.id}: ${failures.join("; ")}`;
        break;
      }
    }
  } catch (e) {
    failure = describeError(e);
  }
  const cleanupProblems = await runCleanup(monitor, deps, local);
  if (cleanupProblems.length > 0) failure = [failure, ...cleanupProblems].filter(Boolean).join("; ");
  return { ok: failure === null, failure, durationMs: deps.now() - t0, steps };
}
