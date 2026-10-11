import js from "@eslint/js";
import globals from "globals";

// 単一責任・純粋さ・決定性の規約（docs/05-automation.md, docs/08-inspection.md）。
// 時刻・乱数・ID 採番は composition root だけが直接呼び、それ以外は注入された関数を使う。
const impureCalls = [
  { object: "Date", property: "now", message: "時刻は clock として注入する" },
  { object: "Math", property: "random", message: "乱数は注入する" },
  { object: "crypto", property: "randomUUID", message: "ID 採番は idGenerator として注入する" },
];

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/.cache/**",
      "**/security-results/**",
      "**/security-findings/**",
      "**/reports/**",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2025, sourceType: "module", globals: { ...globals.node } },
    rules: {
      complexity: ["error", 8],
      "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 4],
      "max-depth": ["error", 3],
      "max-lines": ["error", { max: 250, skipBlankLines: true, skipComments: true }],
      "no-restricted-properties": ["error", ...impureCalls],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "現在時刻は clock として注入する",
        },
      ],
      eqeqeq: "error",
      "no-var": "error",
      "prefer-const": "error",
      "no-console": "error",
    },
  },
  {
    files: ["frontend/src/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // composition root: 副作用の実体を束ねる唯一の場所
    files: ["backend/src/main.js", "frontend/src/main.js"],
    rules: { "no-restricted-properties": "off", "no-restricted-syntax": "off", "no-console": "off" },
  },
  {
    // scripts/<領域>/*.mjs は CLI の入口（composition root）。時刻・環境変数・標準出力をここで束ねる。
    // ロジックは scripts/<領域>/lib/*.mjs に置き、そちらには本番コードと同じ規約を適用する（この override の対象外）。
    // perf/screen/measure.mjs は Docker イメージの中で動く画面計測の入口（同じ扱い）。
    files: ["scripts/*/*.mjs", "perf/screen/measure.mjs"],
    rules: { "no-restricted-properties": "off", "no-restricted-syntax": "off", "no-console": "off" },
  },
  {
    // 外形監視の Playwright ジャーニー: 合成データの識別子に時刻を使う
    files: ["e2e/synthetic/**/*.js"],
    rules: { "no-restricted-properties": "off", "no-restricted-syntax": "off" },
  },
  {
    // k6 スクリプトは Go 製ランタイム上で動き、DI できない。k6 のグローバルを許可し、時刻の直接参照を許す（乱数は使わない）
    files: ["perf/k6/**/*.js"],
    languageOptions: { globals: { __ENV: "readonly", __VU: "readonly", __ITER: "readonly" } },
    rules: { "no-restricted-properties": "off", "no-restricted-syntax": "off" },
  },
  {
    // 画面計測は page.evaluate の中でブラウザのグローバルを使う
    files: ["perf/screen/measure.mjs"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // テストは describe/it の入れ子で関数が長くなるため行数のみ緩める（複雑度・引数は本番と同じ）
    files: ["**/test/**/*.js", "scripts/**/test/**/*.mjs", "e2e/**/*.js"],
    rules: { "max-lines-per-function": "off", "max-lines": "off" },
  },
];
