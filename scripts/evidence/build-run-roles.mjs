#!/usr/bin/env node
// run の役割台帳 docs/evidence/run-roles.yaml を生成する（どの run が対象版の結果で、どれが履歴か）。
//   node scripts/evidence/build-run-roles.mjs [--check]   # --check は書かずに、いまの台帳が生成結果と一致するか確かめる
// 材料: docs/evidence/{runs/*,security,perf,monitoring}/SOURCE.json（取り込んだ run）と perf/results/*/run.json（開発機の性能試験）。
// 対象版 = docs/evidence/release.json の commit_sha（X）。X でない commit の run・未コミットの変更を含む実行は role: history。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { EVIDENCE_DIR, readJson, writeText } from "./lib/common.mjs";
import { readReleaseRecord } from "./lib/release-record.mjs";
import { buildRunRoles } from "./lib/run-roles.mjs";
import { toYaml } from "./lib/yaml-out.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["check"] });
const root = resolve(args.root ?? ".");
const evidence = join(root, EVIDENCE_DIR);
const OUT = join(evidence, "run-roles.yaml");
const RUN_KINDS = ["security", "perf", "monitoring"];

const subdirs = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];

function importedSources() {
  const dirs = [...subdirs(join(evidence, "runs")).map((d) => `runs/${d}`), ...RUN_KINDS];
  return dirs
    .filter((d) => existsSync(join(evidence, d, "SOURCE.json")))
    .map((d) => ({ ...readJson(join(evidence, d, "SOURCE.json")), path: `${EVIDENCE_DIR}/${d}` }));
}

function localPerfRuns() {
  const base = join(root, "perf", "results");
  return subdirs(base)
    .filter((d) => existsSync(join(base, d, "run.json")))
    .map((d) => ({ ...readJson(join(base, d, "run.json")), path: `perf/results/${d}` }));
}

const record = readReleaseRecord(root).data;
if (!record) throw new Error("docs/evidence/release.json が無い、または読めない（対象版を決められない）");
const roles = buildRunRoles({
  sources: importedSources(),
  perfRuns: localPerfRuns(),
  targetSha: record.commit_sha,
});
const text = toYaml(
  { version: 1, release: record.release, target_commit_sha: record.commit_sha, runs: roles },
  [
    "run の役割台帳（生成物。手で編集しない）。scripts/evidence/build-run-roles.mjs が、取り込んだ run の SOURCE.json と perf/results/*/run.json から作る。",
    "role: target = 対象版（release.json の commit_sha）の実行。実施表（kind=regression・performance）の根拠になる。",
    "role: history = 対象版の結果ではない（別の commit・開発機の実験・初回・未コミットの変更を含む実行）。証跡として残すが、実施表・証拠索引の根拠にしない。",
    "GitHub 上のほかの run（取り込んでいないもの）はここに載らない。取り込んだ時点で SOURCE.json から役割が決まる。",
  ],
);

const summary = `${roles.length} 件（target ${roles.filter((r) => r.role === "target").length} / history ${roles.filter((r) => r.role === "history").length}）`;
if (args.check) {
  if (!existsSync(OUT) || readFileSync(OUT, "utf8") !== text) {
    process.stderr.write(
      "エラー: run-roles.yaml が生成結果と一致しない（node scripts/evidence/build-run-roles.mjs で再生成する）\n",
    );
    process.exit(1);
  }
} else {
  writeText(OUT, text);
}
process.stdout.write(`run-roles.yaml: ${summary}\n`);
