// 1 反復ぶんの結果ディレクトリ（iter-N）を読み、分析結果にする。ファイル入出力のみ（時刻・乱数なし）。
// ディレクトリの約束: <name>.summary.json（k6 handleSummary）/ <name>.raw.json.gz（k6 --out json）/ observe.jsonl。
// name は main（load・stress・spike・soak）または step-<件数>（capacity）。warmup.* は判定に使わない。
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeSegment } from "./analyze.mjs";
import { readK6Raw } from "./k6raw.mjs";
import { coverage, parseJsonl, summarizeObserve } from "./observe-parse.mjs";

const GROUPS = { stress: ["stage"], spike: ["phase"], soak: ["bucket"], load: [], capacity: [] };

export async function segmentNames(iterDir) {
  const files = await readdir(iterDir);
  return files
    .map((f) => /^(.+)\.summary\.json$/.exec(f))
    .filter((m) => m && m[1] !== "warmup")
    .map((m) => m[1]);
}

async function analyzeOne(iterDir, name, scenario) {
  const summary = JSON.parse(await readFile(join(iterDir, `${name}.summary.json`), "utf8"));
  const raw = await readK6Raw(join(iterDir, `${name}.raw.json.gz`));
  const env = summary.env || {};
  const opts = { groupBy: GROUPS[scenario] || [] };
  if (scenario === "load" || scenario === "soak" || scenario === "capacity") {
    opts.rate = env.RATE;
    opts.durationSec = env.DURATION_SEC || env.STEP_SEC;
  }
  const seg = analyzeSegment(raw, opts);
  seg.k6_window = summary.window;
  seg.thresholds_failed = Object.entries(summary.metrics)
    .filter(([, m]) => m.thresholds && Object.values(m.thresholds).some((t) => t.ok === false))
    .map(([k]) => k);
  seg.env = env;
  return seg;
}

function overallWindow(segments) {
  const starts = Object.values(segments)
    .map((s) => s.window.start_ms)
    .filter((v) => v !== null);
  const ends = Object.values(segments)
    .map((s) => s.window.end_ms)
    .filter((v) => v !== null);
  return starts.length ? { startMs: Math.min(...starts), endMs: Math.max(...ends) } : null;
}

export async function analyzeIteration(iterDir, scenario, services) {
  const segments = {};
  for (const name of await segmentNames(iterDir)) segments[name] = await analyzeOne(iterDir, name, scenario);
  const win = overallWindow(segments);
  const obsPath = join(iterDir, "observe.jsonl");
  let observe = null;
  let alignment = null;
  if (win && existsSync(obsPath)) {
    const all = parseJsonl(await readFile(obsPath, "utf8"));
    observe = summarizeObserve(all, win, services);
    alignment = {
      k6_start: new Date(win.startMs).toISOString(),
      k6_end: new Date(win.endMs).toISOString(),
      ...coverage(all, win),
    };
  }
  const analysis = {
    scenario,
    segments,
    main_alias: segments.main ? "main" : null,
    observe,
    time_alignment: alignment,
  };
  await writeFile(join(iterDir, "analysis.json"), `${JSON.stringify(analysis, null, 1)}\n`);
  return analysis;
}
