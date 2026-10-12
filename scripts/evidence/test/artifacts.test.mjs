// 成果物台帳・正本の所在地・YAML・取り込み規則・成果物台帳の古さの扱い。一時ディレクトリと合成データで確かめる。
import assert from "node:assert/strict";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";
import { artifactsResult } from "../lib/check-all.mjs";
import {
  artifactEntry,
  describeContent,
  historyFrom,
  parseDocHeader,
  statusFrom,
  typeOf,
} from "../lib/artifacts.mjs";
import { sha256 } from "../lib/common.mjs";
import { KINDS, planKindFiles } from "../lib/kinds.mjs";
import { artifactNames, buildRunSource, planRunFiles, versionOf } from "../lib/run-layout.mjs";
import { buildSourceOfTruth } from "../lib/source-of-truth.mjs";
import { toYaml } from "../lib/yaml-out.mjs";
import { useTmpCleanup } from "./helpers.mjs";
import { describe, it } from "node:test";

useTmpCleanup();

describe("成果物台帳・正本の所在地・YAML", () => {
  const HEADER = `# 03 テスト仕様書\n\n| 項目 | 内容 |\n|---|---|\n| 文書ID | DOC-03 |\n| 版 | 1.0 |\n| 状態 | draft |\n| 作成 | QA 担当（ロール） |\n| 承認 | プロダクトオーナー（ロール。PR 承認で確定） |\n`;

  it("md のヘッダ表から版・状態・作成者を読む。draft は承認前なので approved_by は null（承認を捏造しない）", () => {
    assert.deepEqual(parseDocHeader(HEADER), {
      文書ID: "DOC-03",
      版: "1.0",
      状態: "draft",
      作成: "QA 担当（ロール）",
      承認: "プロダクトオーナー（ロール。PR 承認で確定）",
    });
    const info = describeContent("docs/03-test-spec.md", HEADER, "document");
    assert.deepEqual(
      [info.title, info.version, info.status, info.owner_role, info.approved_by, info.doc_id],
      ["03 テスト仕様書", "1.0", "draft", "QA 担当", null, "DOC-03"],
    );
    const adr = describeContent(
      "docs/adr/0001-x.md",
      "# ADR-0001: x\n\n- 状態: 採用（2026-10-11）\n- 決定者: プロダクトオーナー（口頭承認）\n",
      "adr",
    );
    assert.deepEqual(
      [adr.status, adr.approved_by, adr.owner_role],
      ["approved", "プロダクトオーナー", "プロダクトオーナー"],
    );
    assert.equal(statusFrom("レビュー済"), "reviewed");
  });

  it("ADR は本文の表（規則・値）の「承認」行を承認者と取り違えず、決定者（箇条書き）から読む", () => {
    const adr = [
      "# ADR-0004: 単独メンテナ運用の統制",
      "",
      "- 状態: 採用（定義は 2026-10-11）",
      "- 決定者: プロダクトオーナー（PR #20 のマージをもって承認。フェーズ1は AI が代行マージ）",
      "",
      "## 決定",
      "",
      "| 規則 | 値 |",
      "|---|---|",
      "| 承認 | 1 件 + **code owner review**（`.github/CODEOWNERS`） |",
      "",
    ].join("\n");
    assert.deepEqual(parseDocHeader(adr), {});
    const info = describeContent("docs/adr/0004-x.md", adr, "adr");
    assert.deepEqual(
      [info.status, info.approved_by, info.owner_role],
      ["approved", "プロダクトオーナー", "プロダクトオーナー"],
    );
  });

  it("決定者が複数のロールを並べる ADR は、承認と書かれたロール（プロダクトオーナー）を承認者にする。決定者の先頭は owner_role", () => {
    const multi =
      "# ADR-0002: x\n\n- 状態: 採用（2026-10-11）\n- 決定者: QA リード（ツールの選定）、セキュリティ担当（検査ツールの選定）、プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ）\n";
    const a = describeContent("docs/adr/0002-x.md", multi, "adr");
    assert.deepEqual([a.owner_role, a.approved_by], ["QA リード", "プロダクトオーナー"]);
    const odd =
      "# ADR-0006: x\n\n- 状態: 採用（2026-10-11）\n- 決定者: QA リード（UNK-001 の回答担当ロール）。契約への記載は PR #2、承認はプロダクトオーナー（PR のマージをもって承認）\n";
    assert.equal(describeContent("docs/adr/0006-x.md", odd, "adr").approved_by, "プロダクトオーナー");
    const none = "# ADR-0009: x\n\n- 状態: 採用\n- 決定者: 開発リード\n";
    assert.equal(describeContent("docs/adr/0009-x.md", none, "adr").approved_by, "開発リード");
  });

  it("ヘッダ表の後ろにある別の表の行は、ヘッダの値を上書きしない", () => {
    const md = `${HEADER}\n## 章\n\n| 項目 | 内容 |\n|---|---|\n| 承認 | 別の表の値 |\n`;
    assert.equal(parseDocHeader(md)["承認"], "プロダクトオーナー（ロール。PR 承認で確定）");
  });

  it("台帳の項目: 履歴は git log から（人名は書かず maintainer）、sha256・保存期間・immutable_store", () => {
    const history = historyFrom(["abcdef1234567\t2026-10-11T15:00:00+09:00\tdocs: 追加 (#4)", ""]);
    assert.deepEqual(history, [
      { at: "2026-10-11T15:00:00+09:00", by: "maintainer", change: "docs: 追加 (#4)", commit: "abcdef1" },
    ]);
    const entry = artifactEntry({
      id: "ART-02",
      path: "docs/03-test-spec.md",
      buffer: Buffer.from(HEADER),
      info: describeContent("docs/03-test-spec.md", HEADER, "document"),
      git: { history, lastShort: "abcdef1", updatedAt: "2026-10-11T15:00:00+09:00" },
      authoritative: false,
    });
    assert.equal(entry.source_sha256, sha256(Buffer.from(HEADER)));
    assert.deepEqual(
      [entry.retention_policy, entry.immutable_store, entry.type, entry.status],
      ["Git 履歴は永続。CI artifact は 90 日。リリース添付は永続", true, "document", "draft"],
    );
    assert.equal(typeOf("docs/data/cases.csv"), "table:cases");
    assert.equal(typeOf("README.md"), null);
  });

  it("正本の所在地: 台帳の artifact_id を引き、未作成のものは missing と書く", () => {
    const truth = buildSourceOfTruth(
      [
        { artifact_id: "ART-01", path: "docs/data/requirements.csv" },
        { artifact_id: "ART-04", path: "docs/adr/0001-x.md" },
      ],
      (p) => p !== "perf/slo.yaml",
    );
    assert.deepEqual(
      [
        truth.requirements.artifact_id,
        truth.architecture.artifact_ids,
        truth.slo.status,
        truth.slo.artifact_id,
      ],
      ["ART-01", ["ART-04"], "missing", null],
    );
    assert.equal(truth.defects.authoritative_source, "GitHub Issues（label: defect / flaky）");
  });

  it("YAML の書き出しは yaml-lite で読み戻せる（日付・数字始まりは引用符つき）", () => {
    const value = {
      version: 1,
      items: [
        {
          id: "ART-01",
          at: "2026-10-11T15:00:00+09:00",
          note: "a: b # c",
          empty: [],
          none: null,
          ok: true,
          nested: { k: "v" },
        },
      ],
    };
    assert.deepEqual(parseYaml(toYaml(value, ["コメント"])), value);
  });
});

describe("取り込み規則", () => {
  it("CI の artifact を run ディレクトリの構成へ対応づけ、巨大な trace・report は持ち込まない", () => {
    const plan = planRunFiles([
      "ci-summary/ci-summary.json",
      "e2e-evidence-chromium/test-results/junit.xml",
      "e2e-evidence-chromium/test-results/observations/TC-001.chromium.json",
      "e2e-evidence-chromium/test-results/artifacts/x/trace.zip",
      "e2e-evidence-chromium/playwright-report/index.html",
      "e2e-evidence-compose/test-results/junit.xml",
      "junit-coverage-unit-api/backend/test-results/all.xml",
      "junit-coverage-unit-api/frontend/test-results/observations/TC-002.json",
      "contract-report/backend/test-results/contract.xml",
      "regression-selection/regression-selection.json",
    ]);
    assert.deepEqual(
      plan.map((p) => p.to),
      [
        "ci-summary.json",
        "junit/contract-junit.xml",
        "junit/e2e-chromium-junit.xml",
        "observations/e2e/TC-001.chromium.json",
        "junit/compose-junit.xml",
        "junit/backend-junit.xml",
        "observations/frontend/TC-002.json",
        "regression-selection.json",
      ],
    );
    assert.ok(!plan.some((p) => /trace|report\/index/.test(p.to)));
    assert.deepEqual(
      planRunFiles(["e2e-evidence-webkit/test-results/junit.xml"]).map((p) => p.to),
      ["junit/e2e-webkit-junit.xml"],
    );
  });

  it("SOURCE.json に取得時刻・取得元の run の URL・対象 SHA・版を残す。タグの run は版になる", () => {
    const source = buildRunSource({
      summary: { repository: "o/r", run_id: "9", commit_sha: "a".repeat(40), event: "push", ref: "v1.0.0" },
      nowIso: "2026-10-11T09:00:00.000Z",
      names: artifactNames(["a/x", "b/y", "a/z"]),
      version: versionOf("v1.0.0"),
      repository: "o/r",
    });
    assert.deepEqual(
      [source.captured_at, source.source_url, source.head_sha, source.version, source.artifacts],
      [
        "2026-10-11T09:00:00.000Z",
        "https://github.com/o/r/actions/runs/9",
        "a".repeat(40),
        "1.0.0",
        ["a", "b"],
      ],
    );
    assert.equal(versionOf("main"), "pre-1.0.0");
  });

  it("security の取り込みは SARIF・SBOM・scan-run・findings・gate だけ。大きすぎるファイルは除く", () => {
    const { plan, skipped } = planKindFiles(
      "security",
      [
        "security-scan-sast/codeql/javascript.sarif",
        "security-scan-sca/sbom/sbom.cdx.json",
        "security-findings/findings.json",
        "security-findings/gate.json",
        "security-scan-dast/zap/zap-baseline.html",
        "other/findings.json",
        "security-scan-sast/codeql/scan-run.json",
      ],
      (rel) => (rel.endsWith("sbom.cdx.json") ? 6 * 1024 * 1024 : 10),
    );
    assert.deepEqual(
      plan.map((p) => p.to),
      [
        "security-findings/findings.json",
        "security-findings/gate.json",
        "security-scan-sast/codeql/javascript.sarif",
        "security-scan-sast/codeql/scan-run.json",
      ],
    );
    assert.equal(skipped[0].path, "security-scan-sca/sbom/sbom.cdx.json");
    assert.throws(() => planKindFiles("nope", []), /未知の種類/);
    assert.deepEqual(Object.keys(KINDS), ["security", "perf", "monitoring", "github"]);
  });
});

describe("成果物台帳が古いことの扱い", () => {
  const message = "成果物台帳が最新でない";

  it("既定（strict でも）は警告。失敗にするのは --strict-artifacts のときだけ", () => {
    const warn = artifactsResult({ stale: true, strictArtifacts: false, message });
    assert.deepEqual([warn.status, warn.messages, warn.warnings], ["pass", [], [message]]);
    const fail = artifactsResult({ stale: true, strictArtifacts: true, message });
    assert.deepEqual([fail.status, fail.messages, fail.warnings], ["fail", [message], []]);
  });

  it("最新なら、どちらでも pass で警告なし", () => {
    for (const strictArtifacts of [false, true]) {
      const r = artifactsResult({ stale: false, strictArtifacts, message });
      assert.deepEqual([r.status, r.messages, r.warnings], ["pass", [], []]);
    }
  });
});
