#!/usr/bin/env node
// 証跡一式の検査（CI の docs-check から呼ぶ想定。依存ゼロ）。1 つでも fail なら exit 1。
//   ① manifest の改変検知 ② ID 参照の解決（EV 含む） ③ 抽出パリティ ④ 実施表 ⑤ 不具合表 ⑥ 証拠索引の参照・sha256
//   ⑦ アクション表 ⑧ 追跡表が生成結果と一致 ⑨ 成果物台帳・正本の所在地が最新 ⑩ 秘密情報・個人情報らしい値の簡易検査
//   node scripts/evidence/check-evidence.mjs [--out report.json] [--release <40桁の SHA>] [--allow-mixed-versions] [--strict]
// 成果物台帳（artifacts.yaml・source-of-truth.yaml）が古いことは、既定では警告（--strict でも警告）。失敗にするのは --strict-artifacts だけ
// （release.yml・最終整合の手元実行用。文書 PR のたびに台帳が古くなり、並列の PR が再生成で衝突するのを避けるため）。
// docs/evidence/release.json（リリースの記録。人が取り込み時に書く）があれば、その commit_sha を --release に、--strict で検査する
// （実施表の全行がテストした製品 commit X のもので、版の混在が無いこと）。無ければスキップと明示し、非 strict。
// --structure-only: release.json を見ない構造検査だけ（ID 解決・manifest・パリティ・秘密混入など）。タグの commit X で実行する release.yml が使う。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../ci/lib/args.mjs";
import { parseCsvObjects } from "../ci/lib/csv.mjs";
import { parseYaml } from "../ci/lib/yaml-lite.mjs";
import { DATA_DIR, EVIDENCE_DIR, createReport, toPosix } from "./lib/common.mjs";
import {
  actions,
  apiResults,
  artifactsResult,
  defects,
  executions,
  idReferences,
  parity,
  runRoles,
  sensitive,
  summarizeChecks,
  traceability,
} from "./lib/check-all.mjs";
import { checkEvidenceIndex } from "./lib/evidence-checks.mjs";
import { readManifest, verifyManifest } from "./lib/manifest.mjs";
import { RELEASE_RECORD, readReleaseRecord, releasePlan, releaseRecordCheck } from "./lib/release-record.mjs";

const args = parseArgs(process.argv.slice(2), {
  flags: ["allow-mixed-versions", "strict", "strict-artifacts", "structure-only"],
});
const root = resolve(args.root ?? ".");
const TEXT_EXT = /\.(csv|json|jsonl|xml|md|ya?ml|sarif|txt|html|log|tsv)$/;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

function walk(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

/** リポジトリのオーナー名（不具合のスナップショットの repository。無ければ GITHUB_REPOSITORY）。人名・アカウント名として書かれたものの検査に使う。 */
function ownersOfRepository() {
  const file = join(root, EVIDENCE_DIR, "github/defect-issues.json");
  const repo = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8")).repository
    : process.env.GITHUB_REPOSITORY;
  return [String(repo ?? "").split("/")[0]].filter(Boolean);
}

function loadBundle() {
  const tables = {};
  for (const f of walk(join(root, DATA_DIR)).filter((x) => x.endsWith(".csv"))) {
    tables[f.replace(/\.csv$/, "")] = parseCsvObjects(readFileSync(join(root, DATA_DIR, f), "utf8"));
  }
  const docs = {};
  for (const f of readdirSync(join(root, "docs")).filter((x) => x.endsWith(".md"))) {
    docs[`docs/${f}`] = readFileSync(join(root, "docs", f), "utf8");
  }
  const readme = join(root, EVIDENCE_DIR, "README.md");
  if (existsSync(readme)) docs["docs/evidence/README.md"] = readFileSync(readme, "utf8");
  const scanned = [
    ...walk(join(root, DATA_DIR)).map((f) => `${DATA_DIR}/${f}`),
    ...walk(join(root, EVIDENCE_DIR)).map((f) => `${EVIDENCE_DIR}/${f}`),
  ].filter((p) => TEXT_EXT.test(p) && statSync(join(root, p)).size <= MAX_SCAN_BYTES);
  const textFiles = scanned.map((p) => ({ path: toPosix(p), text: readFileSync(join(root, p), "utf8") }));
  return { tables, docs, textFiles, owners: ownersOfRepository() };
}

/** git が管理するファイルの一覧（追跡中 + 未追跡で除外されていないもの）。git が使えなければ null。 */
function gitManaged() {
  const run = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", EVIDENCE_DIR],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  return run.status === 0 ? new Set(run.stdout.split("\n").filter(Boolean)) : null;
}

/** manifest に載せたファイルが .gitignore で除外されていないか（除外されるとコミットされず、clone した先で欠落になる）。 */
function untrackedEntries(manifest) {
  const tracked = gitManaged();
  if (!tracked || !manifest) return [];
  return manifest.files
    .filter((e) => !tracked.has(`${EVIDENCE_DIR}/${e.path}`))
    .map((e) => `git が管理しない（.gitignore で除外？）: ${e.path}`);
}

function manifestCheck() {
  const report = createReport();
  const manifest = readManifest(join(root, EVIDENCE_DIR));
  if (!manifest) report.error("docs/evidence/manifest.json が無い");
  else for (const p of verifyManifest(join(root, EVIDENCE_DIR), manifest)) report.error(p);
  for (const p of untrackedEntries(manifest)) report.error(p);
  return {
    id: "manifest",
    title: "manifest.json の sha256・size が一致し、欠落・未登録ファイルが無い（改変検知）",
    status: report.ok ? "pass" : "fail",
    messages: report.errors,
    warnings: [],
    stats: { entries: manifest?.files.length ?? 0 },
  };
}

function evidenceIndexCheck(bundle) {
  const report = createReport();
  checkEvidenceIndex(root, bundle.tables["evidence-index"].rows, report);
  return {
    id: "evidence-index",
    title: "証拠索引の参照（ファイル・アンカー）が解決し、sha256 が一致する",
    status: report.ok ? "pass" : "fail",
    messages: report.errors,
    warnings: [],
    stats: { entries: bundle.tables["evidence-index"].rows.length },
  };
}

function traceabilityCheck(bundle) {
  const file = join(root, DATA_DIR, "traceability.csv");
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  return traceability(bundle, current);
}

const record = readReleaseRecord(root);
const plan = releasePlan({
  record,
  releaseArg: args.release,
  strictArg: args.strict,
  structureOnly: args["structure-only"],
});

function artifactsCheck() {
  const run = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./build-artifacts.mjs", import.meta.url)), "--check", "--root", root],
    { cwd: root, encoding: "utf8" },
  );
  const stale = run.status !== 0;
  const message =
    "成果物台帳（artifacts.yaml・source-of-truth.yaml）が最新でない（build-artifacts.mjs で再生成する）";
  return artifactsResult({ stale, strictArtifacts: Boolean(args["strict-artifacts"]), message });
}

function runRolesCheck(bundle) {
  if (args["structure-only"])
    return runRoles({ skip: "構造検査のみ（--structure-only）。run の役割は見ない" });
  if (!record.exists) return runRoles({ skip: `${RELEASE_RECORD} が無い（対象版が決まらないのでスキップ）` });
  const file = join(root, EVIDENCE_DIR, "run-roles.yaml");
  const roles = existsSync(file) ? (parseYaml(readFileSync(file, "utf8")).runs ?? []) : null;
  const run = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./build-run-roles.mjs", import.meta.url)), "--check", "--root", root],
    { cwd: root, encoding: "utf8" },
  );
  return runRoles({ rows: bundle.tables.executions?.rows ?? [], roles, stale: run.status !== 0 });
}

function apiResultsCheck(bundle) {
  const hasMapping = existsSync(join(root, "backend/test/api-tags.yaml"));
  // 生成結果との一致は、release.json（対象の run）があり、構造検査でないときに確かめる（backend/test と run の証跡が要る）
  const regenerate = hasMapping && record.exists && !args["structure-only"];
  const run = regenerate
    ? spawnSync(
        process.execPath,
        [fileURLToPath(new URL("./build-api-results.mjs", import.meta.url)), "--check", "--root", root],
        { cwd: root, encoding: "utf8" },
      )
    : null;
  return apiResults(bundle, { hasMapping, stale: run ? run.status !== 0 : null });
}

const bundle = loadBundle();
const checks = [
  manifestCheck(),
  idReferences(bundle),
  parity(bundle),
  executions(bundle, {
    allowMixedVersions: Boolean(args["allow-mixed-versions"]),
    release: plan.release,
  }),
  defects(bundle),
  evidenceIndexCheck(bundle),
  actions(bundle),
  traceabilityCheck(bundle),
  artifactsCheck(),
  runRolesCheck(bundle),
  apiResultsCheck(bundle),
  sensitive(bundle),
  releaseRecordCheck(record, plan, args["structure-only"]),
];

const icon = { pass: "PASS", fail: "FAIL", skipped: "SKIP" };
for (const c of checks) {
  process.stdout.write(`[${icon[c.status]}] ${c.title} ${JSON.stringify(c.stats)}\n`);
  for (const m of c.messages.slice(0, 20)) process.stdout.write(`    - ${m}\n`);
  if (c.messages.length > 20) process.stdout.write(`    - ほか ${c.messages.length - 20} 件\n`);
  for (const w of c.warnings.slice(0, 10)) process.stdout.write(`    ! ${w}\n`);
}
const summary = summarizeChecks(checks);
if (args.out) {
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify({ schema_version: 1, ...summary, checks }, null, 2)}\n`);
}
process.exitCode = summary.result === "fail" ? 1 : 0;
