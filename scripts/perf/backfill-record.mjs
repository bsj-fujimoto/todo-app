// 既存の run の perf-runs.json に、env_class・基準との比較条件（同じ env_class か）・server_metrics の kind（measured / proxy）を足す（CLI）。
// 他の項目（値・sha・判定）は変えない。perf-runs.json の sha256 が変わるため、同じ run の manifest.json の該当行も更新する。冪等。
// 使い方: node scripts/perf/backfill-record.mjs [perf/results/<run_id> ...]   （引数なしなら perf/results/ の perf-runs.json があるもの全部）
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { comparisonInfo } from "./lib/compare-rules.mjs";
import { annotateRun } from "./lib/record-build.mjs";

const ROOT = "perf/results";
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, obj) => writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);

function updateManifest(runDir, data) {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) return false;
  const manifest = readJson(path);
  const row = manifest.files.find((f) => f.path === "perf-runs.json");
  if (!row) return false;
  Object.assign(row, { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
  writeJson(path, manifest);
  return true;
}

function backfill(runDir, baselines) {
  const path = join(runDir, "perf-runs.json");
  const run = readJson(join(runDir, "run.json"));
  const comparison = comparisonInfo(baselines, run.env_class);
  const runs = readJson(path).map((e) => annotateRun(e, run.env_class, comparison));
  writeJson(path, runs);
  const manifested = updateManifest(runDir, readFileSync(path));
  const note = `env_class ${run.env_class}、比較 ${comparison.status}、manifest ${manifested ? "更新" : "なし"}`;
  console.log(`[backfill] ${runDir}: ${runs.length} 件（${note}）`);
}

const given = process.argv.slice(2);
const dirs = given.length
  ? given
  : readdirSync(ROOT)
      .map((n) => join(ROOT, n))
      .filter((d) => existsSync(join(d, "perf-runs.json")));
const baselines = readJson("perf/baseline.json").baselines;
for (const d of dirs) backfill(d, baselines);
