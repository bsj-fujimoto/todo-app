// 画面側の性能計測（composition root として、時刻・ブラウザ・ネットワークを直接扱う）。Docker イメージ（perf/screen/Dockerfile）の中で動く。
//  1) 表示完了時間（TC-074）: 新しいブラウザコンテキスト（キャッシュなし）で / を開き、一覧の行数が EXPECTED_ROWS に達するまでの時間を
//     ナビゲーション開始（performance.timeOrigin）から測る。REPS 回。DOM の変化を MutationObserver で最初に検知した時刻を使う。
//  2) Lighthouse（performance / accessibility）: LH_RUNS 回。デスクトップ・スロットリングなし（compose 内のネットワークで測るため）。
// 入力は環境変数: BASE_URL, EXPECTED_ROWS, ROW_SELECTOR, REPS, LH_RUNS, OUT_DIR。
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import lighthouse from "lighthouse";

const BASE_URL = process.env.BASE_URL || "http://frontend:8080";
const EXPECTED_ROWS = parseInt(process.env.EXPECTED_ROWS || "1000", 10);
const ROW_SELECTOR = process.env.ROW_SELECTOR || "li";
const REPS = parseInt(process.env.REPS || "10", 10);
const LH_RUNS = parseInt(process.env.LH_RUNS || "3", 10);
const OUT_DIR = process.env.OUT_DIR || "/out";
const WARMUP_NAVIGATIONS = parseInt(process.env.WARMUP_NAVIGATIONS || "3", 10);
const LH_PORT = 9222;

function pct(sorted, p) {
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function describe(values) {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    n: s.length,
    values: values.map((v) => Math.round(v * 10) / 10),
    min: s[0],
    mean: Math.round(mean * 10) / 10,
    p50: pct(s, 0.5),
    p95: Math.round(pct(s, 0.95) * 10) / 10,
    max: s[s.length - 1],
  };
}

const INIT = `
  window.__readyAt = undefined;
  window.__domAt = undefined;
  const sel = ${JSON.stringify(ROW_SELECTOR)};
  const want = ${EXPECTED_ROWS};
  const check = () => {
    if (window.__domAt !== undefined || document.querySelectorAll(sel).length < want) return;
    window.__domAt = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => { window.__readyAt = performance.now(); }));
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true });
`;

async function measureOnce(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__readyAt !== undefined, null, { timeout: 60000 });
  const r = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const api = performance.getEntriesByType("resource").find((e) => e.name.includes("/api/v1/tasks"));
    return {
      ready: window.__readyAt,
      dom: window.__domAt,
      dcl: nav.domContentLoadedEventEnd,
      load: nav.loadEventEnd,
      fcp: fcp ? fcp.startTime : null,
      api_ms: api ? api.duration : null,
      api_bytes: api ? api.transferSize : null,
    };
  });
  await ctx.close();
  return r;
}

function lhSummary(lhr) {
  const a = lhr.audits;
  const failing = Object.values(lhr.audits)
    .filter((x) => lhr.categories.accessibility.auditRefs.some((ref) => ref.id === x.id) && x.score === 0)
    .map((x) => x.id);
  return {
    performance: lhr.categories.performance.score,
    accessibility: lhr.categories.accessibility.score,
    fcp_ms: a["first-contentful-paint"].numericValue,
    lcp_ms: a["largest-contentful-paint"].numericValue,
    tbt_ms: a["total-blocking-time"].numericValue,
    cls: a["cumulative-layout-shift"].numericValue,
    speed_index_ms: a["speed-index"].numericValue,
    accessibility_failed_audits: failing,
  };
}

async function runLighthouse() {
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${LH_PORT}`] });
  const settings = {
    formFactor: "desktop",
    screenEmulation: { mobile: false, width: 1280, height: 800, deviceScaleFactor: 1, disabled: false },
    throttlingMethod: "provided",
    onlyCategories: ["performance", "accessibility"],
    output: "json",
  };
  const runs = [];
  for (let i = 0; i < LH_RUNS; i += 1) {
    const res = await lighthouse(
      BASE_URL,
      { port: LH_PORT, logLevel: "error" },
      { extends: "lighthouse:default", settings },
    );
    runs.push(lhSummary(res.lhr));
    if (i === 0) writeFileSync(`${OUT_DIR}/lighthouse-report-1.json`, JSON.stringify(res.lhr));
  }
  const version = browser.version();
  await browser.close();
  return { runs, chromium: version };
}

async function collectSamples(browser) {
  const warmStart = performance.now();
  for (let i = 0; i < WARMUP_NAVIGATIONS; i += 1) await measureOnce(browser); // 判定から除外（nginx・backend・SQLite を温める）
  const warmupSeconds = Math.max(1, Math.ceil((performance.now() - warmStart) / 1000));
  const samples = [];
  for (let i = 0; i < REPS; i += 1) samples.push(await measureOnce(browser));
  return { samples, warmupSeconds };
}

function describeSamples(samples) {
  const pick = (f) => samples.map(f).filter((v) => v !== null);
  return {
    ready_ms: describe(pick((s) => s.ready)),
    dom_ready_ms: describe(pick((s) => s.dom)),
    dom_content_loaded_ms: describe(pick((s) => s.dcl)),
    load_event_ms: describe(pick((s) => s.load)),
    first_contentful_paint_ms: describe(pick((s) => s.fcp)),
    api_list_ms: describe(pick((s) => s.api_ms)),
    api_list_bytes: samples[0].api_bytes,
  };
}

const DEFINITION =
  "ready_ms = ナビゲーション開始から、一覧の行数が expected_rows に達し、その後 2 フレーム描画されるまでの時間（キャッシュなしの新規コンテキスト、デスクトップ 1280x800、スロットリングなし）。判定の前に WARMUP_NAVIGATIONS 回の読み込みを捨てる";

async function main() {
  const startedAt = new Date().toISOString();
  const tasks = (await (await fetch(`${BASE_URL}/api/v1/tasks`)).json()).tasks.length;
  const browser = await chromium.launch();
  const { samples, warmupSeconds } = await collectSamples(browser);
  const chromiumVersion = browser.version();
  await browser.close();
  const lh = LH_RUNS > 0 ? await runLighthouse() : null;
  const out = {
    started_at: startedAt,
    base_url: BASE_URL,
    tasks,
    expected_rows: EXPECTED_ROWS,
    row_selector: ROW_SELECTOR,
    definition: DEFINITION,
    warmup: { navigations: WARMUP_NAVIGATIONS, seconds: warmupSeconds },
    ...describeSamples(samples),
    lighthouse: lh,
    tool: {
      playwright_core: process.env.PLAYWRIGHT_VERSION || null,
      lighthouse: process.env.LIGHTHOUSE_VERSION || null,
      chromium: chromiumVersion,
    },
  };
  writeFileSync(`${OUT_DIR}/screen.json`, `${JSON.stringify(out, null, 2)}\n`);
  const lhText = lh ? JSON.stringify(lh.runs.map((r) => [r.performance, r.accessibility])) : "skipped";
  console.log(
    `[screen] tasks=${tasks} ready_ms p95=${out.ready_ms.p95} (n=${out.ready_ms.n}) lighthouse=${lhText}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
