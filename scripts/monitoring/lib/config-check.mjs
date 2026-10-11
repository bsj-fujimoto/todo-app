// 監視設定（Monitoring as Code）の整合性検査。純関数。問題を文字列の配列で返す（空なら OK）。
// 検査: 必須項目、slo_ref が perf/slo.yaml に存在、通知経路が全監視を覆う、重要ジャーニーが http/api/browser で守られている、
//       runbook が重要監視を覆い 4 節（一次対応・切り分け・rollback・連絡経路）がある、無効な監視に理由がある。
const REQUIRED = [
  "monitor_id",
  "name",
  "type",
  "target",
  "service",
  "sli",
  "slo_ref",
  "user_impact",
  "regions",
  "interval_sec",
  "timeout_sec",
  "retries",
  "assertions",
  "data_cleanup",
  "pii_policy",
  "defined_in",
  "auth",
];
const SECTIONS = { triage: "一次対応", isolate: "切り分け", rollback: "rollback", contacts: "連絡経路" };
const NON_PING = ["http", "api", "browser"];

const isBlank = (v) => v === undefined || v === null || v === "";

function checkRequired(m) {
  return REQUIRED.filter((key) => isBlank(m[key])).map((key) => `${m.monitor_id}: ${key} が無い`);
}

function checkSemantics(m, sloNames) {
  const rules = [
    [m.slo_ref && !sloNames.has(m.slo_ref), `slo_ref ${m.slo_ref} が perf/slo.yaml に無い`],
    [m.auth && m.auth.inline_credentials !== false, "auth.inline_credentials は false でなければならない"],
    [m.timeout_sec >= m.interval_sec, "timeout_sec が interval_sec 以上"],
    [m.enabled === false && !m.disabled_reason, "無効（enabled: false）なのに理由が無い"],
    [m.type === "api" && !(m.steps || []).length, "api 監視に steps が無い"],
  ];
  return rules.filter(([bad]) => bad).map(([, msg]) => `${m.monitor_id}: ${msg}`);
}

function checkMonitor(m, sloNames) {
  return [...checkRequired(m), ...checkSemantics(m, sloNames)];
}

function checkRoutes(monitors, routes) {
  const routed = new Set((routes.routes || []).flatMap((r) => r.monitor_ids));
  return monitors
    .filter((m) => !routed.has(m.monitor_id))
    .map((m) => `${m.monitor_id}: 通知経路（alert-routes.yaml）が無い`);
}

function checkJourneys(monitors, journeys) {
  const live = monitors.filter((m) => m.enabled !== false);
  return journeys
    .filter((j) => !live.some((m) => m.journey_id === j && NON_PING.includes(m.type)))
    .map((j) => `${j}: http / api / browser の監視が無い`);
}

// runbook の本文に 4 節の見出しがあるか。read(path) は本文を返す関数（無ければ null）
function checkRunbook(rb, read) {
  const body = read(rb.path);
  if (body === null) return [`${rb.runbook_id}: ${rb.path} が無い`];
  const problems = [];
  for (const [flag, heading] of Object.entries(SECTIONS)) {
    const has = new RegExp(`^##\\s+${heading}`, "m").test(body);
    if (rb[flag] && !has) problems.push(`${rb.runbook_id}: 「${heading}」の節が無い`);
  }
  if (!/^##\s+訓練記録/m.test(body)) problems.push(`${rb.runbook_id}: 「訓練記録」の節が無い`);
  return problems;
}

function checkRunbooks(monitors, runbooks, read) {
  const covered = new Set(runbooks.flatMap((r) => r.monitor_ids));
  const important = monitors.filter((m) => m.journey_id && m.enabled !== false);
  const missing = important
    .filter((m) => !covered.has(m.monitor_id))
    .map((m) => `${m.monitor_id}: runbook が無い`);
  return [...missing, ...runbooks.flatMap((rb) => checkRunbook(rb, read))];
}

// browser 監視の「応答時間」の定義（limit_key）が、journey.spec.js に実装されているか（キーがあり、既定値が定義と同じ）
const SPEC = "e2e/synthetic/journey.spec.js";

function checkLimit(m, c, spec) {
  if (spec === null) return [`${m.monitor_id}: ${SPEC} が無い`];
  if (!spec.includes(`LIMITS.${c.limit_key}`)) {
    return [
      `${m.monitor_id}: 応答時間 ${c.limit_key} が journey.spec.js で検査されていない（定義と実装の食い違い）`,
    ];
  }
  const dflt = new RegExp(`${c.limit_key}:\\s*${c.latency_ms_max}\\b`);
  return dflt.test(spec)
    ? []
    : [`${m.monitor_id}: journey.spec.js の ${c.limit_key} の既定値が定義の ${c.latency_ms_max} と違う`];
}

function checkMonitorLimits(m, spec) {
  const latencies = (m.assertions || []).filter((a) => a.kind === "latency");
  const unmeasured = latencies.filter((a) => !(a.check || {}).limit_key);
  const problems = unmeasured.map(
    () => `${m.monitor_id}: latency の assertion に limit_key が無い（測れる形になっていない）`,
  );
  for (const a of latencies.filter((x) => (x.check || {}).limit_key))
    problems.push(...checkLimit(m, a.check, spec));
  return problems;
}

function checkLimits(monitors, read) {
  const spec = read(SPEC);
  return monitors
    .filter((m) => m.type === "browser" && m.enabled !== false)
    .flatMap((m) => checkMonitorLimits(m, spec));
}

export function checkConfig({ monitorsDoc, routes, runbooksDoc, slo, journeys, read }) {
  const sloNames = new Set(slo.slos.map((s) => s.metric));
  const monitors = monitorsDoc.monitors.map((m) => ({ ...monitorsDoc.defaults, ...m }));
  const problems = monitors.flatMap((m) => checkMonitor(m, sloNames));
  problems.push(
    ...checkRoutes(monitors, routes),
    ...checkJourneys(monitors, journeys),
    ...checkRunbooks(monitors, runbooksDoc.runbooks, read),
    ...checkLimits(monitors, read),
  );
  return problems;
}
