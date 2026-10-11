// 外形監視ジャーニー専用の Playwright 設定。e2e/ の playwright.config.js（別担当）とは独立。
// 再試行は run-monitors.mjs が monitors.yaml の retries どおりに行うため、ここでは 0。timeout は監視定義の timeout_sec が上位で制限する。
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "journey.spec.js",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["json"]],
  outputDir: process.env.SYNTHETIC_OUT || "test-results",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:8080",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});
