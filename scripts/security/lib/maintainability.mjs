// ESLint の規約ルールの結果（保守性・性能）を SARIF にし、閾値を設定から読む（純粋関数）。
// 検出は「規約違反」で、脆弱性ではない。lint ジョブ（ci.yml）と同じ設定（eslint.config.js）を使い、
// 閾値・除外・対象 commit を伴う証跡として残す（scan-run.json の check_kind = maintainability / performance）。
// 検査の種類（プロファイル）ごとに、見るルールと分類を持つ。両者は別の scan-run として記録する。
import { relative, sep } from "node:path";

/** 保守性: ルール ID → 分類。分類は scan-run.json の rule_classes にも載る。 */
export const RULE_CLASSES = {
  complexity: "complexity",
  "max-depth": "complexity",
  "max-lines-per-function": "size",
  "max-lines": "size",
  "max-params": "params",
  "no-restricted-properties": "purity",
  "no-restricted-syntax": "purity",
};

/** 性能: ループの中の逐次 await・ループ内の関数生成・無限ループの疑い・競合する更新・不要なコピー。 */
export const PERFORMANCE_RULE_CLASSES = {
  "no-await-in-loop": "loop",
  "no-loop-func": "loop",
  "no-unmodified-loop-condition": "loop",
  "require-atomic-updates": "concurrency",
  "no-promise-executor-return": "concurrency",
  "prefer-object-spread": "allocation",
};

export const PROFILES = {
  maintainability: { kind: "maintainability", label: "保守性", classes: RULE_CLASSES },
  performance: { kind: "performance", label: "性能", classes: PERFORMANCE_RULE_CLASSES },
};

export const ruleClasses = (classes = RULE_CLASSES) => [...new Set(Object.values(classes))].sort();

const levelOf = (severity) => (severity === 1 ? "warning" : "error");

const valueOf = (config) => {
  const opts = [].concat(config).slice(1);
  const first = opts[0];
  if (typeof first === "number") return first;
  if (first && typeof first === "object" && "max" in first) return first.max;
  return opts.length ? opts : null;
};

/** `eslint --print-config <file>` の出力から、ルールの閾値・重大度（ルール → 値）を取り出す。 */
export function thresholdsFrom(printConfig, classes = RULE_CLASSES) {
  const rules = printConfig?.rules ?? {};
  return Object.fromEntries(
    Object.keys(classes)
      .filter((id) => rules[id] !== undefined)
      .map((id) => [
        id,
        { class: classes[id], severity: [].concat(rules[id])[0], value: valueOf(rules[id]) },
      ]),
  );
}

const ruleDescriptor = (id, profile) => ({
  id,
  name: id,
  shortDescription: { text: `${profile.label}（${profile.classes[id]}）: ESLint ${id}` },
  helpUri: `https://eslint.org/docs/latest/rules/${id}`,
  properties: { rule_class: profile.classes[id] },
});

/** ESLint の filePath（絶対パス）を、リポジトリのルートからの相対 URI にする。 */
const uriOf = (file, root) => relative(root, file.filePath).split(sep).join("/");

const toResult = (file, m, root, classes) => ({
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
  properties: { rule_class: classes[m.ruleId] },
});

/** ESLint の JSON 結果 → そのプロファイルのルールだけの SARIF 2.1.0。 */
export function toSarif(eslintResults, { version, thresholds, root, profile = PROFILES.maintainability }) {
  const { classes } = profile;
  const results = eslintResults.flatMap((f) =>
    f.messages.filter((m) => m.ruleId in classes).map((m) => toResult(f, m, root, classes)),
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
            rules: Object.keys(classes).map((id) => ruleDescriptor(id, profile)),
          },
        },
        results,
        properties: { check_kind: profile.kind, thresholds },
      },
    ],
  };
}

/** ESLint の JSON 結果から、そのプロファイルのルールの違反の件数（分類ごと）と、検査したファイル数。 */
export function summarize(eslintResults, classes = RULE_CLASSES) {
  const counts = Object.fromEntries(ruleClasses(classes).map((c) => [c, 0]));
  for (const f of eslintResults)
    for (const m of f.messages) if (m.ruleId in classes) counts[classes[m.ruleId]] += 1;
  return { files: eslintResults.length, violations: counts };
}
