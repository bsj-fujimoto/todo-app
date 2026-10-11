// docs/data/*.csv と台帳 YAML の読み書き（ファイル入出力）。表の列順は schema 側の定数を使い、書くときは必ずその順にする。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsvObjects, toCsv } from "../../ci/lib/csv.mjs";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";
import { DATA_DIR, EVIDENCE_DIR, idsIn, readJson, writeText } from "./common.mjs";
import { EVIDENCE_COLUMNS } from "./evidence-registry.mjs";
import { EXECUTION_COLUMNS } from "./executions.mjs";

export const csvPath = (root, name) => join(root, DATA_DIR, `${name}.csv`);

export function readTable(root, name) {
  const file = csvPath(root, name);
  return existsSync(file) ? parseCsvObjects(readFileSync(file, "utf8")) : { header: [], rows: [] };
}

export function writeTable(root, name, columns, rows) {
  writeText(csvPath(root, name), toCsv(columns, rows));
}

export const readYaml = (root, rel) => {
  const file = join(root, rel);
  return existsSync(file) ? (parseYaml(readFileSync(file, "utf8")) ?? {}) : null;
};

export const loadCases = (root) => readTable(root, "cases").rows;
export const loadExecutions = (root) => readTable(root, "executions").rows;
export const loadEvidenceRows = (root) => readTable(root, "evidence-index").rows;
export const saveExecutions = (root, rows) => writeTable(root, "executions", EXECUTION_COLUMNS, rows);
export const saveEvidenceRows = (root, rows) => writeTable(root, "evidence-index", EVIDENCE_COLUMNS, rows);

/** 手動ケースの実施計画（docs/evidence/manual-plan.yaml）。TC-ID → { environment, reason, owner, retest_due }。 */
export function loadManualPlan(root) {
  const doc = readYaml(root, `${EVIDENCE_DIR}/manual-plan.yaml`);
  return new Map(Object.entries(doc?.cases ?? {}));
}

/** 未解決（open）の不具合の、TC → DEF の対応。fail の行をこれに接続する。 */
export function openDefectsByCase(root) {
  const map = new Map();
  for (const d of readTable(root, "defects").rows.filter((x) => x.status === "open")) {
    for (const tc of idsIn(d.case_ids)) map.set(tc, [...(map.get(tc) ?? []), d.defect_id]);
  }
  return map;
}

export const loadDefectIds = (root) => new Set(readTable(root, "defects").rows.map((d) => d.defect_id));

export const loadSourceMeta = (runDir) => readJson(join(runDir, "SOURCE.json"));
