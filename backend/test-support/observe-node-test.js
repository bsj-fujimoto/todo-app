// node:test 用の観察の自動採取。各テストの終了時に、そのテストが観察した値（API 呼び出し・note・表）を書き出す。
// import するだけで全テストに効く（root の hook）。TC-ID（[TC-xxx]）がタイトルに無いテストは書かない。
import { afterEach, beforeEach } from "node:test";
import { buildEntry, createObservations, observationsDir, writeEntry } from "./observe.js";

/**
 * @param {{ layer: "api" | "unit", component: "backend" | "frontend", project?: string | null }} options
 * @returns 観察の入れ物（note / row / call）。テストから「見た値」を足すときに使う。
 */
export function observeEachTest({ layer, component, project = null }) {
  const obs = createObservations({ layer, component, project });
  beforeEach(() => obs.reset());
  afterEach((t) => {
    obs.finish();
    const entry = buildEntry({ obs, title: t.name, outcome: t.passed ? "passed" : "failed" });
    if (entry.test_case_ids.length === 0) return;
    writeEntry({ dir: observationsDir(component), entry, nameFor: (tcId) => tcId });
  });
  return obs;
}
