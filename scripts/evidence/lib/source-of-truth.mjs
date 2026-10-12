// 正本の所在地（docs/evidence/source-of-truth.yaml）。要求・UI・API・アーキテクチャ・セキュリティ要求・SLO・観点・ケース・不具合。
// 所在（パス）はここで決め、artifact_id は成果物台帳から引く（二重管理しない）。純粋関数。
export const SLOTS = [
  {
    slot: "requirements",
    path: "docs/data/requirements.csv",
    note: "要求（REQ）。行の正本は CSV。docs/02 の表は CSV から機械生成した写し",
  },
  {
    slot: "ui",
    path: "spec/todo-phase1-spec.html",
    note: "画面仕様・入力規則・エラー文言・受け入れ条件（v1.1）",
  },
  {
    slot: "api_spec",
    path: "backend/openapi.yaml",
    note: "API 契約（契約先行。実装との差分は CI の contract で検出）",
  },
  {
    slot: "architecture",
    path: "docs/adr",
    note: "アーキテクチャ判断（ADR）。ディレクトリ配下の全 ADR が対象",
    directory: true,
  },
  {
    slot: "security_requirements",
    path: "security/README.md",
    note: "セキュリティ検査の方針・重大度と SLA・トリアージの規則",
  },
  { slot: "slo", path: "perf/slo.yaml", note: "SLO（性能・可用性の目標）" },
  {
    slot: "test_perspectives",
    path: "docs/data/perspectives.csv",
    note: "テスト観点（VIEW）。行の正本は CSV",
  },
  { slot: "test_cases", path: "docs/data/cases.csv", note: "テストケース（TC）。行の正本は CSV" },
  {
    slot: "defects",
    path: "docs/data/defects.csv",
    note: "不具合の正本は GitHub Issues（label: defect / flaky）。defects.csv は build-defects.mjs が Issue 本文から生成した写しで、直接編集しない",
    extra: {
      authoritative_source: "GitHub Issues（label: defect / flaky）",
      relation:
        "Issues が正本。defects.csv は Issue のスナップショット（docs/evidence/github/defect-issues.json）から再生成できる派生物",
      snapshot: "docs/evidence/github/defect-issues.json",
      generated_by: "scripts/evidence/build-defects.mjs",
    },
  },
  {
    slot: "deviations",
    path: "docs/data/deviations.csv",
    note: "手順からの逸脱（DEV）。正本は docs/09 の DEV 表で、deviations.csv は build-deviations.mjs が表から生成した写し（直接編集しない。check-parity が表との一致を検査する）",
    extra: {
      authoritative_source: "docs/09-test-execution.md の DEV 表",
      generated_by: "scripts/evidence/build-deviations.mjs",
    },
  },
  {
    slot: "api_results",
    path: "docs/data/api-results.csv",
    note: "API テストの結果（endpoint・method・タグ・アサート）。backend/test/api-tags.yaml の対応表と、JUnit・観察値・テスト実装から build-api-results.mjs が生成した派生物（直接編集しない）",
    extra: {
      mapping: "backend/test/api-tags.yaml",
      generated_by: "scripts/evidence/build-api-results.mjs",
    },
  },
];

/** artifacts: 台帳の項目（artifact_id, path）。exists(path): パスが実在するか。 */
export function buildSourceOfTruth(artifacts, exists) {
  const out = {};
  for (const s of SLOTS) {
    const ids = artifacts
      .filter((a) => (s.directory ? a.path.startsWith(`${s.path}/`) : a.path === s.path))
      .map((a) => a.artifact_id);
    const present = exists(s.path) && ids.length > 0;
    out[s.slot] = {
      path: s.path,
      ...(s.directory ? { artifact_ids: ids } : { artifact_id: ids[0] ?? null }),
      authoritative: true,
      status: present ? "present" : "missing",
      note: present ? s.note : `${s.note}（未作成。作成されるまで所在だけを記す）`,
      ...(s.extra ?? {}),
    };
  }
  return out;
}
