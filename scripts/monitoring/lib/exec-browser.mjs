// browser 監視（Playwright のジャーニー）の 1 回の試行。プロセス起動は deps.spawnFn として受け取る。
// 実行: npx --prefix e2e/synthetic playwright test -c <config> --grep <grep> --reporter=json
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const firstLine = (message) => String(message).replace(ANSI_RE, "").split("\n")[0];

function failedResults(spec) {
  return (spec.tests || [])
    .flatMap((t) => t.results || [])
    .filter((r) => r.status !== "passed" && r.error)
    .map((r) => `${spec.title}: ${firstLine(r.error.message)}`);
}

function collectErrors(node, out) {
  for (const spec of node.specs || []) out.push(...failedResults(spec));
  for (const s of node.suites || []) collectErrors(s, out);
  return out;
}

export function parseReport(stdout) {
  try {
    const report = JSON.parse(stdout);
    return { stats: report.stats, errors: collectErrors({ suites: report.suites }, []) };
  } catch {
    return null;
  }
}

export function playwrightArgs(monitor) {
  const r = monitor.runner;
  return [
    "--prefix",
    "e2e/synthetic",
    "playwright",
    "test",
    "-c",
    r.config,
    "--grep",
    r.grep,
    "--reporter=json",
  ];
}

// 応答時間の上限（assertions の check.limit_key / latency_ms_max）を journey.spec.js に渡す（定義が正本）
export function limitsOf(monitor) {
  const limits = {};
  for (const a of monitor.assertions || []) {
    const c = a.check;
    if (c && c.limit_key && c.latency_ms_max !== undefined) limits[c.limit_key] = c.latency_ms_max;
  }
  return limits;
}

export async function runBrowserAttempt(monitor, deps, ctx) {
  const t0 = deps.now();
  const env = {
    BASE_URL: ctx.baseUrl,
    SYNTHETIC_RUN_ID: ctx.vars.run_id,
    SYNTHETIC_OUT: ctx.playwrightOut,
    SYNTHETIC_LIMITS: JSON.stringify(limitsOf(monitor)),
    SYNTHETIC_MONITOR_ID: monitor.monitor_id,
  };
  const out = await deps.spawnFn("npx", playwrightArgs(monitor), {
    env,
    timeoutMs: monitor.timeout_sec * 1000,
  });
  const durationMs = deps.now() - t0;
  if (out.timedOut)
    return { ok: false, failure: `タイムアウト（${monitor.timeout_sec} 秒）`, durationMs, steps: [] };
  const report = parseReport(out.stdout);
  if (!report)
    return {
      ok: false,
      failure: `Playwright の結果を読めない（exit ${out.code}）: ${out.stderr.slice(0, 200)}`,
      durationMs,
      steps: [],
    };
  const ok = out.code === 0 && report.stats.unexpected === 0 && report.stats.expected >= 1;
  const failure = ok
    ? null
    : report.errors.join("; ") || `テストが実行されなかった（grep ${monitor.runner.grep}）`;
  return {
    ok,
    failure,
    durationMs,
    steps: [{ id: "playwright", status: out.code, durationMs: Math.round(durationMs) }],
  };
}
