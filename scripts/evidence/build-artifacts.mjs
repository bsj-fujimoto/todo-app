#!/usr/bin/env node
// 成果物台帳 docs/evidence/artifacts.yaml と、正本の所在地 docs/evidence/source-of-truth.yaml を生成する。
//   node scripts/evidence/build-artifacts.mjs [--check]   # --check は書かずに、いまの台帳が生成結果と一致するか確かめる
// 項目は文書のヘッダ表（文書ID・版・状態・作成・承認）と git log から作る（手書きしない）。承認の記録が無ければ approved_by は null。
// artifact_id（ART-nn）はパスごとに固定（既存の台帳を引き継ぎ、新しい文書には次の番号を振る）。
// 履歴・更新日時はコミット済みの内容から作る。未コミットの変更があるファイルは警告する（コミット後に再生成する）。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../ci/lib/args.mjs";
import { parseYaml } from "../ci/lib/yaml-lite.mjs";
import { EVIDENCE_DIR, shortSha, writeText } from "./lib/common.mjs";
import { artifactEntry, describeContent, historyFrom, typeOf } from "./lib/artifacts.mjs";
import { SLOTS, buildSourceOfTruth } from "./lib/source-of-truth.mjs";
import { toYaml } from "./lib/yaml-out.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["check"] });
const root = resolve(args.root ?? ".");
const git = (...argv) =>
  spawnSync("git", argv, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
const ARTIFACTS = join(root, EVIDENCE_DIR, "artifacts.yaml");
const TRUTH = join(root, EVIDENCE_DIR, "source-of-truth.yaml");

const paths = git("ls-files", "--cached", "--others", "--exclude-standard")
  .split("\n")
  .filter((p) => p && typeOf(p) && existsSync(join(root, p)))
  .sort();
const dirty = new Set(
  git("status", "--porcelain", "--", ...paths)
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3)),
);

const existing = existsSync(ARTIFACTS) ? (parseYaml(readFileSync(ARTIFACTS, "utf8")) ?? {}) : {};
const idByPath = new Map((existing.artifacts ?? []).map((a) => [a.path, a.artifact_id]));
let next = Math.max(0, ...[...idByPath.values()].map((id) => Number(/ART-(\d+)/.exec(id)?.[1] ?? 0))) + 1;
const idFor = (path) => idByPath.get(path) ?? `ART-${String(next++).padStart(2, "0")}`;

const authoritativePaths = new Set(SLOTS.map((s) => s.path));
function gitInfo(path) {
  const log = git("log", "--format=%H%x09%aI%x09%s", "--", path).split("\n");
  const history = historyFrom(log);
  const first = log[0]?.split("\t");
  return {
    history,
    lastShort: first ? shortSha(first[0]) : null,
    updatedAt: first?.[1] ?? new Date(statSync(join(root, path)).mtime).toISOString(),
  };
}

const entries = paths.map((path) => {
  const buffer = readFileSync(join(root, path));
  const type = typeOf(path);
  const info = describeContent(path, buffer.toString("utf8"), type);
  const authoritative =
    authoritativePaths.has(path) || [...authoritativePaths].some((p) => path.startsWith(`${p}/`));
  return artifactEntry({ id: idFor(path), path, buffer, info, git: gitInfo(path), authoritative });
});
for (const p of paths.filter((x) => dirty.has(x)))
  process.stderr.write(
    `警告: ${p} に未コミットの変更がある（履歴・更新日時に反映されない。コミット後に再生成する）\n`,
  );

const artifactsYaml = toYaml(
  { version: 1, generated_by: "scripts/evidence/build-artifacts.mjs", artifacts: entries },
  [
    "成果物台帳（生成物。手で編集しない）。文書のヘッダ表と git log から scripts/evidence/build-artifacts.mjs が作る。",
    "approved_by は承認済み（status: approved）と文書に書かれたものだけ。承認の記録が無いものは null（承認を捏造しない）。",
    "history の by は役割（maintainer）。人名は書かない。保存: Git 履歴は永続（Ruleset で force push・削除を禁止）、CI artifact は 90 日。",
  ],
);
const truthYaml = toYaml(
  {
    version: 1,
    generated_by: "scripts/evidence/build-artifacts.mjs",
    source_of_truth: buildSourceOfTruth(entries, (p) => existsSync(join(root, p))),
  },
  [
    "正本の所在地（生成物。手で編集しない。所在は scripts/evidence/lib/source-of-truth.mjs、artifact_id は artifacts.yaml から）。",
  ],
);

if (args.check) {
  const same = (file, text) => existsSync(file) && readFileSync(file, "utf8") === text;
  if (!same(ARTIFACTS, artifactsYaml) || !same(TRUTH, truthYaml)) {
    process.stderr.write(
      "エラー: artifacts.yaml / source-of-truth.yaml が生成結果と一致しない（node scripts/evidence/build-artifacts.mjs で再生成する）\n",
    );
    process.exit(1);
  }
} else {
  writeText(ARTIFACTS, artifactsYaml);
  writeText(TRUTH, truthYaml);
}
process.stdout.write(
  `artifacts.yaml: ${entries.length} 件（承認済み ${entries.filter((e) => e.approved_by).length} 件、正本 ${entries.filter((e) => e.authoritative).length} 件）\n`,
);
