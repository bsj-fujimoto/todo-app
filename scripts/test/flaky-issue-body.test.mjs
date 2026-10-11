// nightly が自動起票する flaky の Issue 本文が、不具合 Issue の様式（証跡の defects.csv の生成が読む形）を満たすことの検査。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractFields } from "../evidence/lib/defects.mjs";
import { buildReport } from "../regression/lib/flaky.mjs";

describe("flaky の Issue 本文", () => {
  it("defect.md の見出し・項目を持ち、証跡の生成が必須の項目（検出工程・原因分類・ケースなど）を読み取れる", () => {
    const tests = [
      { key: "k", layer: "api", name: "[TC-073] x", tc_ids: ["TC-073"], runs: 3, failures: 1, rate: 1 / 3 },
    ];
    const report = buildReport({ tests, ledger: [], today: "2026-10-11", sha: "abc", nowIso: "n" });
    const c = report.issue_candidates[0];
    for (const h of [
      "## 識別",
      "## 再現手順",
      "## 期待結果",
      "## 実際の結果",
      "## 影響",
      "## 関連ケース / 証拠",
      "## 原因分類",
    ]) {
      assert.ok(c.body.includes(h), h);
    }
    const f = extractFields({
      number: 99,
      title: c.title,
      body: c.body,
      labels: [{ name: "flaky" }],
      state: "OPEN",
    });
    assert.deepEqual(f.case_ids, ["TC-073"]);
    assert.equal(f.detected_phase, "api");
    assert.equal(f.cause_class, "test");
    assert.equal(f.severity, "minor");
  });
});
