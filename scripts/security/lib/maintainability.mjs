// 保守性の検査（ESLint の複雑度・大きさ・引数・純粋性のルール）の結果を SARIF にし、閾値を設定から読む（純粋関数）。
// 検出は「規約違反」で、脆弱性ではない。lint ジョブ（ci.yml）と同じ設定（eslint.config.js）を使い、
// 閾値・除外・対象 commit を伴う証跡として残す（scan-run.json の check_kind = maintainability）。

import { relative, sep } from "node:path";

/** ルール ID → 分類。分類は scan-run.json の rule_classes にも載る。 */
export const RULE_CLASSES = {
  complexity: "complexity",
  "max-depth": "complexity",
  "max-lines-per-function": "size",
  "max-lines": "size",
  "max-params": "params",
  "no-restricted-properties": "purity",
  "no-restricted-syntax": "purity",
};

export const ruleClasses = () => [...new Set(Object.values(RULE_CLASSES))].sort();

const levelOf = (severity) => (severity === 1 ? "warning" : "error");

const valueOf = (config) => {
  const opts = [].concat(config).slice(1);
  const first = opts[0];
  if (typeof first === "number") return first;
  if (first && typeof first === "object" && "max" in first) return first.max;
  return opts.length ? opts : null;
};

/** `eslint --print-config <file>` の出力から、保守性ルールの閾値（ルール → 値）を取り出す。 */
export function thresholdsFrom(printConfig) {
  const rules = printConfig?.rules ?? {};
  return Object.fromEntries(
    Object.keys(RULE_CLASSES)
      .filter((id) => rules[id] !== undefined)
      .map((id) => [
        id,
        { class: RULE_CLASSES[id], severity: [].concat(rules[id])[0], value: valueOf(rules[id]) },
      ]),
  );
}

const ruleDescriptor = (id) => ({
  id,
  name: id,
  shortDescription: { text: `保守性（${RULE_CLASSES[id]}）: ESLint ${id}` },
  helpUri: `https://eslint.org/docs/latest/rules/${id}`,
  properties: { rule_class: RULE_CLASSES[id] },
});

/** ESLint の filePath（絶対パス）を、リポジトリのルートからの相対 URI にする。 */
const uriOf = (file, root) => relative(root, file.filePath).split(sep).join("/");

const toResult = (file, m, root) => ({
  ruleId: m.ruleId,
  level: levelOf(m.severity),
  message: { text: m.message },
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri: uriOf(file, root) },
        region: { startLine: m.line ?? 1, startColumn: m.column ?? 1 },
      },
    },
  ],
  properties: { rule_class: RULE_CLASSES[m.ruleId] },
});

/** ESLint の JSON 結果 → 保守性ルールだけの SARIF 2.1.0。 */
export function toSarif(eslintResults, { version, thresholds, root }) {
  const results = eslintResults.flatMap((f) =>
    f.messages.filter((m) => m.ruleId in RULE_CLASSES).map((m) => toResult(f, m, root)),
  );
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "ESLint",
            semanticVersion: version,
            informationUri: "https://eslint.org",
            rules: Object.keys(RULE_CLASSES).map(ruleDescriptor),
          },
        },
        results,
        properties: { check_kind: "maintainability", thresholds },
      },
    ],
  };
}

/** ESLint の JSON 結果から、保守性ルールの違反の件数（分類ごと）と、検査したファイル数。 */
export function summarize(eslintResults) {
  const counts = Object.fromEntries(ruleClasses().map((c) => [c, 0]));
  for (const f of eslintResults)
    for (const m of f.messages) if (m.ruleId in RULE_CLASSES) counts[RULE_CLASSES[m.ruleId]] += 1;
  return { files: eslintResults.length, violations: counts };
}
