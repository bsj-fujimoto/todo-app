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
    // テストは describe/it の入れ子で関数が長くなるため行数のみ緩める（複雑度・引数は本番と同じ）
    files: ["**/test/**/*.js", "e2e/**/*.js"],
    rules: { "max-lines-per-function": "off", "max-lines": "off" },
  },
];
