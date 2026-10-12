// 画面計測（screen）の run に、サーバ側の観測（observe.jsonl）を時刻整合して結びつける。ファイル入出力のみ（時刻・乱数なし）。
// ディレクトリの約束: screen/screen.json（通常件数）と screen/screen-<件数>.json、観測は screen/obs-<件数>/observe.jsonl。
// 時刻整合の窓 = screen.json の started_at 〜 finished_at（warm-up の読み込み・計測・Lighthouse をすべて含む）。
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coverage, parseJsonl, summarizeObserve } from "./observe-parse.mjs";

export function windowOf(screen) {
  const startMs = Date.parse(screen.started_at);
  const endMs = Date.parse(screen.finished_at);
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? { startMs, endMs } : null;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

// 1 つの件数の計測（screenFile）に対する観測の要約。観測が無い・窓が決まらないときは null
async function observeFor(screenDir, screenFile, tasksKey, services) {
  const obs = join(screenDir, `obs-${tasksKey}`, "observe.jsonl");
  const screenPath = join(screenDir, screenFile);
  if (!existsSync(obs) || !existsSync(screenPath)) return null;
  const win = windowOf(await readJson(screenPath));
  if (!win) return null;
  const all = parseJsonl(await readFile(obs, "utf8"));
  return {
    observe: summarizeObserve(all, win, services),
    time_alignment: {
      k6_start: new Date(win.startMs).toISOString(),
      k6_end: new Date(win.endMs).toISOString(),
      window_definition: "screen.json の started_at〜finished_at",
      ...coverage(all, win),
    },
  };
}

// screen/analysis.json を書く。通常件数（screen.json の tasks）の観測を observe に、件数ごとを by_tasks に置く。
// 観測が 1 本も無ければ null（古い run・観測なしの実行）
export async function analyzeScreenObserve(screenDir, services) {
  const normal = await readJson(join(screenDir, "screen.json"));
  const files = [["screen.json", String(normal.tasks)]];
  if (existsSync(join(screenDir, "screen-10000.json"))) files.push(["screen-10000.json", "10000"]);
  const byTasks = {};
  for (const [file, key] of files) {
    const r = await observeFor(screenDir, file, key, services);
    if (r) byTasks[key] = r;
  }
  const main = byTasks[String(normal.tasks)];
  if (!main) return null;
  const analysis = {
    scenario: "screen",
    ...main,
    by_tasks: byTasks,
  };
  await writeFile(join(screenDir, "analysis.json"), `${JSON.stringify(analysis, null, 1)}\n`);
  return analysis;
}
