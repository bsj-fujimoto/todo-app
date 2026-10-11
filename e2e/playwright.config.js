import { defineConfig, devices } from "@playwright/test";

const desktop = { width: 1280, height: 800 };

// 各テストが専用のスタック（fixtures/stack.js）を起動するため、compose 以外は並列実行しても汚染しない。
// retries は 0（再試行で失敗を隠さない）。
export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results/artifacts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [
    ["list"],
    ["junit", { outputFile: "test-results/junit.xml" }],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    locale: "ja-JP",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: desktop },
      grepInvert: /@mobile/,
    },
    {
      // 互換ケース（@cross-browser）だけを 3 ブラウザで同じ手順で実行する
      name: "firefox",
      use: { ...devices["Desktop Firefox"], viewport: desktop },
      grep: /@cross-browser/,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: desktop },
      grep: /@cross-browser/,
    },
    {
      // 幅 360px・タッチ（@mobile）
      name: "chromium-mobile-360",
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 640 } },
      grep: /@mobile/,
    },
    {
      // docker compose の本物の nginx・コンテナ・ボリューム（直列。npm run e2e:compose は --workers=1 を付ける）
      name: "compose",
      testDir: "./compose",
      testMatch: "stack.spec.js",
      fullyParallel: false,
      timeout: 300_000,
      use: { ...devices["Desktop Chrome"], viewport: desktop },
    },
  ],
});
