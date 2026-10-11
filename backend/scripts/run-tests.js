// node --test の起動ラッパ。通常出力（spec）と JUnit XML（test-results/）の両方を出し、カバレッジを取る。
// 使い方: node scripts/run-tests.js <unit|api|contract|all>
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BACKEND_DIR = fileURLToPath(new URL("..", import.meta.url));
const COVERAGE_LINE_THRESHOLD = 90;

const LAYERS = {
  unit: ["test/unit/**/*.test.js"],
  api: ["test/api/**/*.test.js"],
  contract: ["test/api/contract.test.js"],
  all: ["test/unit/**/*.test.js", "test/api/**/*.test.js"],
};

function buildArgs(layer) {
  const args = [
    "--test",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=junit",
    `--test-reporter-destination=test-results/${layer}.xml`,
  ];
  // カバレッジの対象は本番コード（src/）。しきい値は全層を流す `all` のときだけ強制する
  if (layer !== "contract") args.push("--experimental-test-coverage", "--test-coverage-include=src/**/*.js");
  if (layer === "all") args.push(`--test-coverage-lines=${COVERAGE_LINE_THRESHOLD}`);
  // 並列度の調整（安定性の検証用）: TEST_CONCURRENCY=1 で直列、未指定は node の既定
  if (process.env.TEST_CONCURRENCY) args.push(`--test-concurrency=${process.env.TEST_CONCURRENCY}`);
  return [...args, ...LAYERS[layer]];
}

function main(layer) {
  if (!LAYERS[layer]) {
    process.stderr.write(`未知の層: ${layer}（${Object.keys(LAYERS).join(" / ")}）\n`);
    return 2;
  }
  mkdirSync(`${BACKEND_DIR}test-results`, { recursive: true });
  const result = spawnSync(process.execPath, buildArgs(layer), { cwd: BACKEND_DIR, stdio: "inherit" });
  return result.status ?? 1;
}

process.exitCode = main(process.argv[2] ?? "all");
