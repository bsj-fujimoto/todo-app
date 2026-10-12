// 実行間隔の実測（schedule の実効間隔）。純関数。時刻は引数で受け取る（now を内部で読まない）。
// 宣言（workflow の cron）と実測（Actions の実行履歴）を並べるための集計と、watchdog のしきい値の導出を持つ。
const DAY_MS = 86400000;
const HOUR_SEC = 3600;

// ---- cron（分・時・曜日だけを展開する。日・月は * のみ対応。本リポジトリの cron はすべてこの範囲） ----------------------------

function stepOf(stepText) {
  const step = stepText === undefined ? 1 : Number(stepText);
  if (!Number.isInteger(step) || step < 1) throw new Error(`cron のステップが不正: ${stepText}`);
  return step;
}

// "*" / "a" / "a-b" / "a/n" / "a-b/n" / "*/n" の端点
function boundsOf(spec, stepText, min, max) {
  if (spec === "*") return [min, max];
  const [a, b] = spec.split("-").map(Number);
  if (b !== undefined) return [a, b];
  return [a, stepText === undefined ? a : max];
}

function rangeOf(part, min, max) {
  const [spec, stepText] = part.split("/");
  const step = stepOf(stepText);
  const [lo, hi] = boundsOf(spec, stepText, min, max);
  if (![lo, hi].every(Number.isInteger) || lo < min || hi > max || lo > hi)
    throw new Error(`cron の範囲が不正: ${part}`);
  const out = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  return out;
}

function parseField(field, min, max) {
  return new Set(field.split(",").flatMap((p) => rangeOf(p, min, max)));
}

export function parseCron(cron) {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`cron は 5 項目: ${cron}`);
  if (f[2] !== "*" || f[3] !== "*") throw new Error(`日・月の指定は未対応: ${cron}`);
  const dow = new Set([...parseField(f[4], 0, 7)].map((d) => d % 7));
  return { minutes: parseField(f[0], 0, 59), hours: parseField(f[1], 0, 23), dow };
}

function slotsOfDay(day, { minutes, hours }) {
  const hs = [...hours].sort((x, y) => x - y);
  const ms = [...minutes].sort((x, y) => x - y);
  return hs.flatMap((h) => ms.map((m) => day + h * 3600000 + m * 60000));
}

// cron が出す枠（UTC のエポック ms）。fromMs 以上 toMs 以下を昇順で返す
export function slotsBetween(cron, fromMs, toMs) {
  const parsed = typeof cron === "string" ? parseCron(cron) : cron;
  const out = [];
  for (let day = Math.floor(fromMs / DAY_MS) * DAY_MS; day <= toMs; day += DAY_MS) {
    if (parsed.dow.has(new Date(day).getUTCDay())) out.push(...slotsOfDay(day, parsed));
  }
  return out.filter((t) => t >= fromMs && t <= toMs);
}

export function slotsOfAll(crons, fromMs, toMs) {
  const all = crons.flatMap((c) => slotsBetween(c, fromMs, toMs));
  return [...new Set(all)].sort((a, b) => a - b);
}

// ---- 統計 ----------------------------------------------------------------------------------------------------------------

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { n: 0, min: null, median: null, mean: null, p90: null, max: null };
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  return {
    n,
    min: sorted[0],
    median: quantile(sorted, 0.5),
    mean,
    p90: quantile(sorted, 0.9),
    max: sorted[n - 1],
  };
}

// 昇順にした時刻（ms）の隣り合う差（秒）
export function intervalsSec(timesMs) {
  const t = [...timesMs].sort((a, b) => a - b);
  return t.slice(1).map((v, i) => Math.round((v - t[i]) / 1000));
}

// ---- 1 つのワークフローの集計 ---------------------------------------------------------------------------------------------

// 各実行の、対応する宣言の枠からの遅れ（秒）。欠落が無い（実行数 = 枠の数）ときだけ、時刻順に 1 対 1 で対応づけられる。
// 欠落があると、どの枠が落ちたか分からず対応づけられない（GitHub は遅れた枠を溜めず落とす）ため、空にする。
function delaysSec(slots, timesMs) {
  if (slots.length !== timesMs.length) return [];
  return timesMs.map((t, i) => Math.round((t - slots[i]) / 1000));
}

const RAN = (r) => !["skipped", "cancelled", "startup_failure"].includes(r.conclusion);

// runs: [{ created_at, event, conclusion, ... }]。crons: 宣言（workflow の schedule の cron）。
// windowStartIso: schedule が有効になった時点（既定ブランチにワークフローが入った時刻）。無ければ最初の実行。
function scheduleSummary({ sched, slots, startMs, nowMs }) {
  const gaps = intervalsSec(sched.map((r) => r.ms));
  const last = sched.length ? sched[sched.length - 1] : null;
  return {
    runs: sched.length,
    first: sched.length ? sched[0].created_at : null,
    last: last ? last.created_at : null,
    first_delay_sec: sched.length ? Math.round((sched[0].ms - startMs) / 1000) : null,
    since_last_sec: last ? Math.round((nowMs - last.ms) / 1000) : null,
    missing: Math.max(0, slots.length - sched.length),
    intervals_sec: gaps,
    interval_stats_sec: stats(gaps),
    delays_sec: delaysSec(
      slots,
      sched.map((r) => r.ms),
    ),
  };
}

export function summarizeWorkflow({ file, crons, runs, windowStartIso, nowMs }) {
  const sched = runs
    .filter((r) => r.event === "schedule")
    .map((r) => ({ ...r, ms: Date.parse(r.created_at) }))
    .sort((a, b) => a.ms - b.ms);
  const ran = runs.filter(RAN).map((r) => Date.parse(r.created_at));
  const startMs = windowStartIso ? Date.parse(windowStartIso) : (sched[0] || { ms: nowMs }).ms;
  const slots = slotsOfAll(crons, startMs, nowMs);
  // 宣言の間隔は、観測期間の長短に左右されないよう、基準の 1 週間（有効化から 7 日）の枠の間隔の中央値
  const declared = intervalsSec(slotsOfAll(crons, startMs, startMs + 7 * DAY_MS));
  return {
    file,
    declared: {
      crons,
      interval_sec: declared.length ? stats(declared).median : null,
      slots_in_window: slots.length,
    },
    window: { start: new Date(startMs).toISOString(), end: new Date(nowMs).toISOString() },
    runs_times: sched.map((r) => r.created_at),
    schedule: scheduleSummary({ sched, slots, startMs, nowMs }),
    all_events: {
      runs: runs.length,
      by_event: countBy(runs, (r) => r.event),
      by_conclusion: countBy(runs, (r) => r.conclusion || r.status || "unknown"),
      interval_stats_sec: stats(intervalsSec(ran)),
    },
  };
}

function countBy(items, key) {
  const out = {};
  for (const it of items) out[key(it)] = (out[key(it)] || 0) + 1;
  return out;
}

// ---- watchdog のしきい値（実測から決める規則） ---------------------------------------------------------------------------

export const THRESHOLD_MARGIN_HOURS = 1;
export const MIN_INTERVALS = 3;

// 規則: しきい値 = 最大の実測間隔（schedule）を時間に切り上げ + 余裕 1 時間。標本が MIN_INTERVALS 未満なら決められない。
export function recommendThresholdHours(maxIntervalSec, intervalsCount) {
  if (maxIntervalSec === null || intervalsCount < MIN_INTERVALS)
    return { hours: null, basis: `標本不足（間隔 ${intervalsCount} 件 < ${MIN_INTERVALS} 件）` };
  const maxH = maxIntervalSec / HOUR_SEC;
  const hours = Math.ceil(maxH) + THRESHOLD_MARGIN_HOURS;
  return {
    hours,
    basis: `最大実測間隔 ${maxH.toFixed(1)} 時間を切り上げて ${Math.ceil(maxH)} 時間 + 余裕 ${THRESHOLD_MARGIN_HOURS} 時間`,
  };
}

// ---- 表示 ----------------------------------------------------------------------------------------------------------------

export function fmtDuration(sec) {
  if (sec === null || sec === undefined) return "-";
  if (sec < 5400) return `${(sec / 60).toFixed(0)} 分`;
  return `${(sec / HOUR_SEC).toFixed(1)} 時間`;
}

function row(w) {
  const s = w.schedule.interval_stats_sec;
  return [
    w.file,
    w.declared.crons.join(" / "),
    fmtDuration(w.declared.interval_sec),
    `${w.schedule.runs} / ${w.declared.slots_in_window}`,
    String(w.schedule.missing),
    fmtDuration(s.median),
    fmtDuration(s.p90),
    fmtDuration(s.max),
    fmtDuration(w.schedule.first_delay_sec),
    w.schedule.delays_sec.map(fmtDuration).join(", ") || "-",
  ];
}

const HEAD = [
  "ワークフロー",
  "宣言（cron）",
  "宣言の間隔",
  "schedule 実行 / 宣言の枠",
  "欠落",
  "実効間隔 中央値",
  "p90",
  "最大",
  "有効化から初回まで",
  "枠からの遅れ",
];

function detail(w) {
  return [
    `## ${w.file}`,
    "",
    `- 期間: ${w.window.start} 〜 ${w.window.end}（有効化 = 既定ブランチにワークフローが入った時刻）`,
    `- schedule の実行時刻（UTC）: ${w.runs_times.join(", ") || "なし"}`,
    `- 隣り合う間隔: ${w.schedule.intervals_sec.map(fmtDuration).join(", ") || "なし"}`,
    `- 直近の実行から取得時点まで: ${fmtDuration(w.schedule.since_last_sec)}`,
    `- 全トリガーの実行: ${JSON.stringify(w.all_events.by_event)}、結論: ${JSON.stringify(w.all_events.by_conclusion)}`,
    "",
  ];
}

const NOTES = [
  "欠落 = 宣言の cron が出した枠の数 − schedule で実際に起動した数（有効化〜取得時点。GitHub は schedule を遅延させ、負荷時は欠落させる）",
  "枠からの遅れは、欠落が無く実行と枠を 1 対 1 に対応づけられるときだけ出す（欠落があると、どの枠が落ちたか分からない。「-」）。そのときは実効間隔で見る",
];

export function renderMarkdown({ generatedAt, repo, workflows, recommendation }) {
  return [
    `# schedule の実行間隔（宣言と実測）`,
    "",
    `- 取得: ${generatedAt}（UTC）、対象: ${repo}。\`node scripts/monitoring/cadence.mjs\` で再取得できる（gh api の読み取りのみ）`,
    ...NOTES.map((n) => `- ${n}`),
    "",
    `| ${HEAD.join(" | ")} |`,
    `| ${HEAD.map(() => "---").join(" | ")} |`,
    ...workflows.map((w) => `| ${row(w).join(" | ")} |`),
    "",
    ...workflows.flatMap(detail),
    "## watchdog のしきい値（synthetic.yml の schedule の実測から）",
    "",
    `- ${recommendation.basis}${recommendation.hours === null ? "" : ` → **${recommendation.hours} 時間**`}`,
    "",
  ].join("\n");
}
