// 監視の実行の組み立て（純粋な制御。通信・時刻・プロセスは deps で受け取る）。
import { runBrowserAttempt } from "./exec-browser.mjs";
import { runApiAttempt, runHttpAttempt } from "./exec-http.mjs";
import { runWithRetries } from "./retry.mjs";
import { evaluateSuppression } from "./suppress.mjs";
import { interpolate } from "./vars.mjs";

const EXECUTORS = { http: runHttpAttempt, api: runApiAttempt, browser: runBrowserAttempt };

export function severityOf(routes, monitorId) {
  const route = (routes.routes || []).find((r) => r.monitor_ids.includes(monitorId));
  return route ? route.severity : "sev2";
}

// monitors.yaml の defaults を各監視に重ねる（監視側の指定を優先）
export function withDefaults(monitor, defaults) {
  return {
    ...defaults,
    ...monitor,
    auth: monitor.auth || defaults.auth,
    regions: monitor.regions || defaults.regions,
    enabled: monitor.enabled !== false,
  };
}

function buildVars(base, monitor, run) {
  return {
    ...base,
    synthetic_title: `synthetic-${run.run_id}-${monitor.monitor_id}`,
    repeat_a_101: "a".repeat(101),
  };
}

// 1 つの監視を、定義どおりの retry・timeout で実行して記録（run history の 1 行）と結果を返す
export async function runMonitor(monitor, env) {
  const { deps, run, ctx, maintenance, markers } = env;
  const startedMs = deps.wallMs();
  const monCtx = { ...ctx, vars: buildVars(ctx.vars, monitor, run) };
  const exec = EXECUTORS[monitor.type];
  const fixed = interpolate(monitor, monCtx.vars);
  const outcome = await runWithRetries(
    () => exec(fixed, deps, monCtx),
    { retries: monitor.retries, delayMs: run.retry_delay_sec * 1000 },
    deps,
  );
  const suppression = outcome.ok
    ? null
    : evaluateSuppression({ monitorId: monitor.monitor_id, nowMs: startedMs, maintenance, markers });
  const record = {
    monitor_id: monitor.monitor_id,
    at: new Date(startedMs).toISOString(),
    result: outcome.ok ? "ok" : "fail",
    duration_ms: Math.round(outcome.last.durationMs),
    failure_detail: outcome.ok ? null : outcome.failures.join(" | "),
    version: run.version,
    attempts: outcome.attempts,
    alert_suppressed: suppression !== null,
    suppression_reason: suppression ? `${suppression.rule_id}: ${suppression.reason}` : null,
    run_id: run.run_id,
    phase: run.phase,
    mode: run.mode,
    region: run.region,
  };
  return { record, steps: outcome.last.steps };
}
