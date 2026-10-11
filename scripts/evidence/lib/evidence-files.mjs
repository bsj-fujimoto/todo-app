// docs/evidence/ に取り込んだファイル → 証拠索引の項目（主張・領域・観点・種別）。純粋関数 + ファイル走査。
// 実施表の行ごとの証拠（JUnit・観察値）は build-executions.mjs が採番する。ここは run 全体・セキュリティ・性能・監視・GitHub 統制の証拠。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MANAGED_DIRS, readJson, sha256, shortSha, toPosix } from "./common.mjs";
import { resolveFndId } from "./findings.mjs";

const SECURITY_RULES = [
  [
    /scan-run\.json$/,
    "inspection-01",
    "scan-run",
    "検査の実行記録（対象 SHA・ツールと版・コマンド・設定・走査範囲・出力の sha256）",
  ],
  [
    /(findings|gate)\.json$|triage-summary\.md$/,
    "inspection-16",
    "triage",
    "トリアージ後の検出一覧と判定（重複排除・台帳の適用・前回差分・ゲート）",
  ],
  [/(codeql|sast)[^/]*\.sarif$|\/codeql\//, "inspection-06", "sarif", "SAST（CodeQL）の検査結果"],
  [/zap/, "inspection-07", "sarif", "DAST（OWASP ZAP）の検査結果"],
  [/sbom|\.cdx\.json$|osv|npm-audit/, "inspection-08", "cyclonedx", "SBOM / SCA の結果"],
  [/license/, "inspection-10", "json", "ライセンス方針の評価"],
  [/workflow|actionlint|governance/, "inspection-14", "json", "GitHub Actions のワークフロー統制の検査結果"],
  [
    /trivy|hadolint|compose-check|gitleaks|secrets/,
    "inspection-09",
    "sarif",
    "Container / IaC / Secret の検査結果",
  ],
];

const RUN_RULES = [
  [
    /^runs\/[^/]+\/ci-summary\.json$/,
    "execution",
    "execution-10",
    "ci-summary",
    "run の層別の結果・対象 SHA・ジョブの結果（ci-summary.json）",
  ],
  [
    /^runs\/[^/]+\/regression-selection\.json$/,
    "regression",
    "regression-04",
    "selection",
    "run の回帰選択（モードと選択理由・除外したリスク）",
  ],
  [
    /^runs\/[^/]+\/docs-check-report\.json$/,
    "evidence",
    "evidence-04",
    "docs-check",
    "docs-check の結果（ID 参照・manifest・TC-ID・リンク）",
  ],
  [/^runs\/[^/]+\/coverage-[^/]+\.json$/, "quality", "quality-05", "coverage", "カバレッジの集計"],
  [
    /^runs\/[^/]+\/SOURCE\.json$/,
    "evidence",
    "evidence-01",
    "source",
    "run の取得元（URL）・対象 SHA・取得時刻",
  ],
];

const OTHER_RULES = [
  [
    /^github\/defect-issues\.json$/,
    "execution",
    "execution-07",
    "issue-snapshot",
    "不具合 Issue（label: defect / flaky）のスナップショット",
  ],
  [
    /^github\/.*(ruleset|branch)/i,
    "inspection",
    "inspection-13",
    "json",
    "GitHub Ruleset / Branch protection の取得結果",
  ],
  [/^github\/.*(workflow|actions)/i, "inspection", "inspection-14", "json", "GitHub Actions 統制の取得結果"],
  [
    /^github\/.*(dependabot|dependency)/i,
    "inspection",
    "inspection-15",
    "json",
    "Dependabot / Dependency review の取得結果",
  ],
  [/^perf\/.*\.(json|jsonl|md)$/, "performance", "performance-09", "json", "性能試験の結果"],
  [/^monitoring\/.*\.(json|jsonl|md)$/, "monitoring", "monitoring-11", "json", "外形監視の実行結果"],
];

const SOURCE_FILE = /(^|\/)SOURCE\.json$/;

/** 相対パス（docs/evidence から）→ { domain, criterion_id, type, what } または null（索引に載せないファイル）。 */
export function describeFile(rel) {
  if (/^runs\/[^/]+\/(junit|observations)\//.test(rel)) return null; // 実施表の行ごとの証拠で採番する
  const run = RUN_RULES.find(([re]) => re.test(rel));
  if (run) return { domain: run[1], criterion_id: run[2], type: run[3], what: run[4] };
  if (rel.startsWith("security/") && !SOURCE_FILE.test(rel)) {
    const rule = SECURITY_RULES.find(([re]) => re.test(rel));
    return rule ? { domain: "inspection", criterion_id: rule[1], type: rule[2], what: rule[3] } : null;
  }
  const other = OTHER_RULES.find(([re]) => re.test(rel));
  return other ? { domain: other[1], criterion_id: other[2], type: other[3], what: other[4] } : null;
}

function listFiles(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

/** docs/evidence の管理対象（MANAGED_DIRS）の全ファイル（docs/evidence からの相対パス、昇順）。 */
export function listManagedFiles(evidenceDir) {
  return MANAGED_DIRS.flatMap((d) => listFiles(join(evidenceDir, d), `${d}/`))
    .map(toPosix)
    .sort();
}

/** そのファイルの取得元（run ディレクトリまたは種類ディレクトリの SOURCE.json）。 */
export function sourceOf(evidenceDir, rel) {
  const parts = rel.split("/");
  const dir = parts[0] === "runs" ? parts.slice(0, 2) : parts.slice(0, 1);
  const file = join(evidenceDir, ...dir, "SOURCE.json");
  return existsSync(file) ? readJson(file) : null;
}

const refFor = (rel, anchor) => `./docs/evidence/${rel}${anchor ? `#${anchor}` : ""}`;

function claimFor(rel, what, source) {
  const where = source?.run_id ? `run ${source.run_id}` : (source?.kind ?? "");
  return `${what}（${rel.split("/").slice(0, -1).join("/") || rel}。${where}、対象 ${shortSha(source?.head_sha)}）`;
}

/** 検出ごとの証拠（FND-nnn → findings.json の finding_id）。findings.json があれば、検出 1 件を 1 項目にする。 */
function findingEntries(evidenceDir, rel, source, ledger) {
  const file = join(evidenceDir, rel);
  const doc = readJson(file);
  const sha = sha256(readFileSync(file));
  return (doc.findings ?? []).map((f) => ({
    claim: `${resolveFndId(f, ledger)}: ${f.severity} ${f.tool} ${f.rule_id}${f.component ? ` ${f.component}` : ""}（status ${f.status}）`,
    ref: refFor(rel, f.finding_id),
    domain: "inspection",
    criterion_id: "inspection-16",
    type: "finding",
    sha256: sha,
    captured_at: source?.captured_at ?? null,
    head_sha: source?.head_sha ?? null,
  }));
}

/** docs/evidence の全ファイル → 証拠索引の項目（実施表の行ごとの証拠を除く）。 */
export function collectEvidenceEntries(evidenceDir, ledger) {
  const entries = [];
  for (const rel of listManagedFiles(evidenceDir)) {
    const info = describeFile(rel);
    if (!info) continue;
    const source = sourceOf(evidenceDir, rel);
    entries.push({
      claim: claimFor(rel, info.what, source),
      ref: refFor(rel),
      domain: info.domain,
      criterion_id: info.criterion_id,
      type: info.type,
      sha256: sha256(readFileSync(join(evidenceDir, rel))),
      captured_at: source?.captured_at ?? null,
      head_sha: source?.head_sha ?? null,
    });
    if (/security\/.*findings\.json$/.test(rel))
      entries.push(...findingEntries(evidenceDir, rel, source, ledger));
  }
  return entries;
}
