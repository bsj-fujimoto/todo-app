// 保守性の検査（scripts/security/lib/maintainability.mjs）の単体テスト。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RULE_CLASSES,
  ruleClasses,
  summarize,
  thresholdsFrom,
  toSarif,
} from "../security/lib/maintainability.mjs";

const eslintResults = [
  {
    filePath: "/repo/backend/src/a.js",
    messages: [
      { ruleId: "complexity", severity: 2, message: "too complex", line: 3, column: 1 },
      { ruleId: "no-unused-vars", severity: 2, message: "unused", line: 1, column: 1 },
      { ruleId: "no-restricted-properties", severity: 2, message: "Date.now", line: 9, column: 5 },
    ],
  },
  {
    filePath: "/repo/backend/src/b.js",
    messages: [{ ruleId: "max-params", severity: 1, message: "5 params" }],
  },
  { filePath: "/repo/backend/src/c.js", messages: [] },
];

describe("保守性の SARIF", () => {
  it("分類は complexity・size・params・purity の 4 つ", () => {
    assert.deepEqual(ruleClasses(), ["complexity", "params", "purity", "size"]);
    assert.equal(RULE_CLASSES["max-depth"], "complexity");
  });

  it("保守性ルールの違反だけを結果にし、分類・位置・水準を持つ", () => {
    const sarif = toSarif(eslintResults, {
      version: "10.12.0",
      thresholds: { complexity: { value: 8 } },
      root: "/repo",
    });
    const run = sarif.runs[0];
    assert.equal(sarif.version, "2.1.0");
    assert.equal(run.tool.driver.semanticVersion, "10.12.0");
    assert.deepEqual(
      run.results.map((r) => [r.ruleId, r.level, r.properties.rule_class]),
      [
        ["complexity", "error", "complexity"],
        ["no-restricted-properties", "error", "purity"],
        ["max-params", "warning", "params"],
      ],
    );
    assert.equal(run.results[0].locations[0].physicalLocation.artifactLocation.uri, "backend/src/a.js");
    assert.equal(run.results[0].locations[0].physicalLocation.region.startLine, 3);
    assert.equal(run.results[2].locations[0].physicalLocation.region.startLine, 1, "位置が無ければ 1 行目");
    assert.equal(run.properties.thresholds.complexity.value, 8);
  });

  it("件数は分類ごと、検査したファイル数も数える", () => {
    assert.deepEqual(summarize(eslintResults), {
      files: 3,
      violations: { complexity: 1, params: 1, purity: 1, size: 0 },
    });
  });
});

describe("閾値の読み取り", () => {
  it("数値・{ max }・オブジェクトの列を値として取り出し、設定の無いルールは含めない", () => {
    const t = thresholdsFrom({
      rules: {
        complexity: [2, 8],
        "max-lines-per-function": [2, { max: 40, skipBlankLines: true }],
        "no-restricted-properties": [2, { object: "Date", property: "now" }],
        "max-params": [2, 4],
        eqeqeq: [2],
      },
    });
    assert.equal(t.complexity.value, 8);
    assert.equal(t["max-lines-per-function"].value, 40);
    assert.equal(t["max-params"].class, "params");
    assert.deepEqual(t["no-restricted-properties"].value, [{ object: "Date", property: "now" }]);
    assert.equal("max-depth" in t, false);
    assert.equal("eqeqeq" in t, false);
  });
});
