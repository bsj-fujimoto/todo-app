#!/usr/bin/env node
// 回帰スイート台帳 quality/regression-suite.csv を docs/data/cases.csv から生成する。
//   node scripts/regression/build-suite.mjs            # 生成して書き込む
//   node scripts/regression/build-suite.mjs --check    # 生成結果が保存済みの台帳と一致するか検査（CI。ずれたら失敗）
// 手で編集しない。ジャーニーは quality/journeys.yaml、smoke は quality/impact-map.yaml、隔離は quality/flaky-ledger.yaml が正本。
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { loadInputs, renderSuite, validateJourneys } from "./lib/suite.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["check"] });
const root = resolve(args.root ?? ".");
const out = join(root, "quality/regression-suite.csv");

const inputs = loadInputs(root);
const problems = validateJourneys(inputs);
if (problems.length) {
  process.stderr.write(`journeys.yaml の不整合:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}
const text = renderSuite(inputs);
if (args.check) {
  const current = readFileSync(out, "utf8");
  if (current !== text) {
    process.stderr.write(
      "quality/regression-suite.csv が生成結果と一致しない。`node scripts/regression/build-suite.mjs` で再生成する。\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    `regression-suite.csv は最新（${inputs.cases.length} ケース、ジャーニー ${inputs.journeys.length} 件）\n`,
  );
} else {
  writeFileSync(out, text);
  process.stdout.write(`書き込み: ${out}（${inputs.cases.length} ケース）\n`);
}
