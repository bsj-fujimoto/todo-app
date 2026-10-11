// 証拠索引・manifest（改変検知）・追跡表・アクション表・パリティ・秘密情報の検査・成果物台帳・取り込み規則。一時ディレクトリと合成データで確かめる。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";
import { checkActions } from "../lib/actions.mjs";
import { artifactsResult } from "../lib/check-all.mjs";
import {
  artifactEntry,
  describeContent,
  historyFrom,
  parseDocHeader,
  statusFrom,
  typeOf,
} from "../lib/artifacts.mjs";
import { createReport, sha256 } from "../lib/common.mjs";
import { checkEvidenceIndex } from "../lib/evidence-checks.mjs";
import { collectEvidenceEntries, describeFile } from "../lib/evidence-files.mjs";
import { createRegistry } from "../lib/evidence-registry.mjs";
import { findingRows } from "../lib/findings-table.mjs";
import { toFndId } from "../lib/findings.mjs";
import { checkReferences } from "../lib/id-check.mjs";
import { KINDS, planKindFiles } from "../lib/kinds.mjs";
import {
  buildManifest,
  buildManifestFiles,
  readManifest,
  sameFiles,
  verifyManifest,
} from "../lib/manifest.mjs";
import { checkParity, countClaims } from "../lib/parity.mjs";
import { artifactNames, buildRunSource, planRunFiles, versionOf } from "../lib/run-layout.mjs";
import { scanFiles, scanText } from "../lib/sensitive.mjs";
import { buildSourceOfTruth } from "../lib/source-of-truth.mjs";
import { buildTraceability } from "../lib/traceability.mjs";
import { toYaml } from "../lib/yaml-out.mjs";

const dirs = [];
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "evidence-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function put(root, rel, content) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** docs/evidence 相当の小さなツリー（run と security の 2 つ）。 */
function evidenceTree() {
  const root = tmp();
  const source = (extra) =>
    JSON.stringify({
      captured_at: "2026-10-11T09:00:00.000Z",
      source_url: "https://example.test/run/1",
      head_sha: "a".repeat(40),
      version: "pre-1.0.0",
      ...extra,
    });
  put(root, "runs/1/SOURCE.json", source({ run_id: "1" }));
  put(root, "runs/1/ci-summary.json", '{"layers":{}}');
  put(root, "runs/1/junit/e2e-chromium-junit.xml", '<testcase name="[TC-001] x"/>');
  put(root, "security/SOURCE.json", source({ kind: "security", run_id: "2" }));
  put(
    root,
    "security/security-findings/findings.json",
    JSON.stringify({
      findings: [
        {
          finding_id: "F-001",
          severity: "medium",
          tool: "trivy",
          rule_id: "CVE-1",
          component: "zlib",
          status: "accepted",
        },
      ],
    }),
  );
  put(root, "security/security-scan-sast/codeql/scan-run.json", "{}");
  return root;
}

describe("証拠索引の採番", () => {
  it("同じ（参照, 主張）は同じ EV を保ち、新しいものは次の番号。unreferenced は prune で落とせる", () => {
    const a = {
      claim: "TC-001 は pass",
      ref: "./a#TC-001",
      domain: "execution",
      criterion_id: "execution-06",
      type: "junit",
      sha256: "1",
      captured_at: "t",
      head_sha: "h",
    };
    const first = createRegistry();
    assert.equal(first.allocate(a), "EV-0001");
    assert.equal(first.allocate({ ...a, claim: "別" }), "EV-0002");
    const again = createRegistry(first.rows());
    assert.equal(again.allocate({ ...a, sha256: "2" }), "EV-0001");
    assert.equal(again.get("EV-0001").sha256, "2");
    assert.equal(again.allocate({ ...a, ref: "./b" }), "EV-0003");
    again.prune((row) => row.evidence_id === "EV-0002");
    assert.deepEqual(
      again.rows().map((r) => r.evidence_id),
      ["EV-0002"],
    );
  });
});

describe("manifest（改変検知）", () => {
  it("全ファイルを記録し、改変・欠落・未登録・取得元の欠けを検出する。内容が同じなら書き換えない", () => {
    const root = evidenceTree();
    const files = buildManifestFiles(root);
    assert.deepEqual(
      files.map((f) => f.path),
      [
        "runs/1/SOURCE.json",
        "runs/1/ci-summary.json",
        "runs/1/junit/e2e-chromium-junit.xml",
        "security/SOURCE.json",
        "security/security-findings/findings.json",
        "security/security-scan-sast/codeql/scan-run.json",
      ],
    );
    assert.deepEqual(Object.keys(files[1]), [
      "path",
      "sha256",
      "size",
      "captured_at",
      "source",
      "version",
      "head_sha",
    ]);
    const manifest = buildManifest(files, "2026-10-11T09:00:00.000Z");
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    assert.deepEqual(verifyManifest(root, manifest), []);
    assert.equal(sameFiles(readManifest(root), files), true);

    put(root, "runs/1/ci-summary.json", '{"layers":{"x":1}}'); // 改変
    put(root, "runs/1/new.json", "{}"); // 未登録
    rmSync(join(root, "security/security-scan-sast/codeql/scan-run.json")); // 欠落
    const problems = verifyManifest(root, manifest).join("\n");
    assert.match(problems, /sha256 不一致（改変の疑い）: runs\/1\/ci-summary.json/);
    assert.match(problems, /サイズ不一致: runs\/1\/ci-summary.json/);
    assert.match(problems, /未登録: runs\/1\/new.json/);
    assert.match(problems, /欠落: security\/security-scan-sast\/codeql\/scan-run.json/);
  });

  it("取得元（SOURCE.json）の無いファイルは管理対象にできない", () => {
    const root = tmp();
    put(root, "perf/result.json", "{}");
    assert.throws(() => buildManifestFiles(root), /SOURCE.json が無い/);
  });

  it("scripts/ci/lib/docs-checks.mjs の checkManifest が読める形（files[].path・sha256）", () => {
    const root = evidenceTree();
    const m = buildManifest(buildManifestFiles(root), "t");
    for (const e of m.files) assert.equal(sha256(Buffer.from(JSON.stringify(e))).length, 64);
    assert.ok(Array.isArray(m.files) && m.files.every((e) => e.path && /^[0-9a-f]{64}$/.test(e.sha256)));
  });
});

describe("証拠索引の項目と検査", () => {
  it("run 全体・セキュリティの証拠を、領域・観点・アンカーつきで作る（JUnit・観察値は実施表側）", () => {
    const root = evidenceTree();
    const entries = collectEvidenceEntries(root);
    const byRef = new Map(entries.map((e) => [e.ref, e]));
    assert.equal(byRef.get("./docs/evidence/runs/1/ci-summary.json").criterion_id, "execution-10");
    assert.equal(
      byRef.get("./docs/evidence/security/security-scan-sast/codeql/scan-run.json").criterion_id,
      "inspection-01",
    );
    const finding = byRef.get("./docs/evidence/security/security-findings/findings.json#F-001");
    assert.match(finding.claim, /^FND-001: medium trivy CVE-1 zlib（status accepted）/);
    assert.equal(describeFile("runs/1/junit/e2e-chromium-junit.xml"), null);
    assert.equal(describeFile("security/SOURCE.json"), null);
  });

  it("解決しない参照・sha256 の不一致・アンカーの不一致は失敗にする", () => {
    const root = tmp();
    put(root, "docs/evidence/runs/1/junit/e2e-junit.xml", '<testcase name="[TC-016] x"/>');
    const sha = sha256(Buffer.from('<testcase name="[TC-016] x"/>'));
    const row = (ref, sha256v) => ({
      evidence_id: "EV-0001",
      claim: "c",
      ref,
      domain: "execution",
      criterion_id: "execution-06",
      type: "junit",
      sha256: sha256v,
      captured_at: "t",
      head_sha: "h",
    });
    const run = (r) => {
      const report = createReport();
      checkEvidenceIndex(root, [r], report);
      return report.errors.join("\n");
    };
    assert.equal(run(row("./docs/evidence/runs/1/junit/e2e-junit.xml#TC-016", sha)), "");
    assert.match(run(row("./docs/evidence/runs/1/junit/e2e-junit.xml#TC-999", sha)), /アンカーが解決しない/);
    assert.match(
      run(row("./docs/evidence/runs/1/junit/e2e-junit.xml#TC-016", "0".repeat(64))),
      /sha256 が一致しない/,
    );
    assert.match(run(row("./docs/evidence/runs/2/none.xml", sha)), /参照先のファイルが無い/);
    assert.equal(run(row("https://github.com/o/r/actions/runs/1", "")), "");
  });
});

describe("追跡表・アクション表・検出表", () => {
  const tables = {
    requirements: [{ id: "REQ-001" }, { id: "REQ-002" }],
    risks: [{ id: "RISK-001" }, { id: "RISK-002" }],
    perspectives: [
      { perspective_id: "VIEW-001", applicability: "applicable" },
      { perspective_id: "VIEW-002", applicability: "applicable" },
    ],
    cases: [
      {
        test_case_id: "TC-001",
        requirement_ids: "REQ-001",
        risk_ids: "RISK-001",
        perspective_ids: "VIEW-001",
      },
    ],
    executions: [{ execution_id: "EXEC-0001", test_case_id: "TC-001", status: "pass" }],
    defects: [
      { defect_id: "DEF-001", case_ids: "TC-001", detected_phase: "e2e" },
      { defect_id: "DEF-002", case_ids: "", detected_phase: "review" },
    ],
    findings: [
      { finding_id: "FND-001", status: "tp" },
      { finding_id: "FND-002", status: "na" },
    ],
    actions: [
      { action_id: "ACT-001", what: "DEF-001 の修正", finding_ids: "FND-001" },
      { action_id: "ACT-002", what: "どこにも結び付かない", finding_ids: "" },
      { action_id: "ACT-003", what: "DEF-002 の対応", finding_ids: "" },
    ],
  };

  it("REQ→RISK→VIEW→TC→EXEC→DEF→FND→ACT をたどれ、欠落は gaps 付きの行として残す", () => {
    const rows = buildTraceability(tables);
    assert.deepEqual(rows[0], {
      trace_id: "TR-001",
      requirement_ids: "REQ-001",
      risk_ids: "RISK-001",
      perspective_ids: "VIEW-001",
      test_case_id: "TC-001",
      execution_ids: "EXEC-0001",
      defect_ids: "DEF-001",
      finding_ids: "FND-001",
      action_ids: "ACT-001",
      gaps: "",
    });
    const gaps = rows.filter((r) => r.gaps).map((r) => r.gaps);
    assert.deepEqual(
      gaps.sort(),
      [
        "ケース・検出・不具合に結び付かないアクション",
        "対応するケースがない",
        "対応するケースがない",
        "適用の観点にケースがない",
        "関連ケースがない（検出した手段: review）",
      ].sort(),
    );
    // ケースの無い不具合の行は、その不具合に触れるアクションとつなぐ
    assert.equal(rows.find((r) => r.defect_ids === "DEF-002" && !r.test_case_id).action_ids, "ACT-003");
    assert.equal(buildTraceability(tables).length, rows.length); // 冪等
  });

  it("ID 参照の解決: 未定義の ID を指摘する", () => {
    const t = (header, rows) => ({ header, rows });
    const { unresolved } = checkReferences({
      cases: t(
        ["test_case_id", "requirement_ids"],
        [{ test_case_id: "TC-001", requirement_ids: "REQ-001;REQ-404" }],
      ),
      requirements: t(["id"], [{ id: "REQ-001" }]),
      evidence: t(["evidence_id", "claim"], [{ evidence_id: "EV-0001", claim: "TC-001 と FND-009" }]),
    });
    assert.deepEqual(unresolved.map((u) => u.id).sort(), ["FND-009", "REQ-404"]);
  });

  it("アクション表: 様式・語彙・日付・finding_ids の解決", () => {
    const ok = {
      action_id: "ACT-001",
      what: "w",
      finding_ids: "FND-001",
      domain: "inspection",
      priority: "low",
      phase: "operation",
      when: "w",
      owner: "QA 担当",
      due: "2026-12-31",
      reverify_by: "未定（理由）",
      status: "open",
      review_date: "2026-12-31",
    };
    const good = createReport();
    checkActions([ok], new Set(["FND-001"]), good);
    assert.deepEqual(good.errors, []);
    const bad = createReport();
    checkActions(
      [{ ...ok, action_id: "A-1", domain: "x", due: "来月", finding_ids: "FND-404", owner: "" }, ok, ok],
      new Set(["FND-001"]),
      bad,
    );
    const text = bad.errors.join("\n");
    assert.match(text, /action_id が ACT-nnn の形でない/);
    assert.match(text, /domain が語彙外/);
    assert.match(text, /due が日付/);
    assert.match(text, /finding_ids の FND-404 が findings.csv に無い/);
    assert.match(text, /owner が空/);
    assert.match(text, /ACT-001: action_id が重複/);
  });

  it("検出表: F-001 を FND-001 に写し、元の ID を残す", () => {
    assert.equal(toFndId("F-007"), "FND-007");
    assert.equal(toFndId("FND-012"), "FND-012");
    assert.equal(toFndId("X-1"), null);
    const rows = findingRows({
      run_url: "https://example.test/r",
      target: { commit_sha: "a".repeat(40) },
      findings: [
        {
          finding_id: "F-002",
          severity: "medium",
          status: "accepted",
          tool: "trivy",
          title: "zlib\nの穴",
          accepted_by: "AR-001",
          expires_at: "2027-01-09",
          issue: "#22",
        },
      ],
    });
    assert.deepEqual(
      [
        rows[0].finding_id,
        rows[0].source_finding_id,
        rows[0].title,
        rows[0].ledger_ref,
        rows[0].due,
        rows[0].head_sha.length,
      ],
      ["FND-002", "F-002", "zlib の穴", "AR-001", "2027-01-09", 40],
    );
  });
});

describe("検出の仮 ID の解決", () => {
  const doc = {
    findings: [
      { finding_id: "FND-001", fingerprint: "aaa", severity: "low", status: "na", tool: "t" },
      {
        finding_id: "FND-NEW-bbbbbb",
        fingerprint: "bbb",
        severity: "medium",
        status: "accepted",
        tool: "codeql",
      },
    ],
  };

  it("triage が仮 ID（FND-NEW-xxxxxx）を付けた検出は、台帳の fingerprint から FND-nnn に引く（取り込んだ findings.json は書き換えない）", () => {
    const rows = findingRows(doc, new Map([["bbb", "FND-010"]]));
    assert.deepEqual(
      rows.map((r) => [r.finding_id, r.source_finding_id]),
      [
        ["FND-001", "FND-001"],
        ["FND-010", "FND-NEW-bbbbbb"],
      ],
    );
  });

  it("台帳に無い仮 ID は、採番の手順つきで失敗する", () => {
    assert.throws(() => findingRows(doc, new Map()), /assign-finding-ids/);
  });
});

describe("抽出パリティ・秘密情報の検査", () => {
  const t = (n, header = ["a"]) => ({
    header,
    rows: Array.from({ length: n }, () => ({ applicability: "applicable", status: "ready" })),
  });

  it("md の「N 件（PREFIX）」と表の行数、列の記載を突き合わせ、不一致を検出する", () => {
    const md = "ケース 77 件（TC）。要求 34 件（REQ）、観点 69 行（VIEW）。`cases.csv` の列: `a`, `b`。";
    assert.deepEqual(
      countClaims(md).map((c) => [c.prefix, c.count]),
      [
        ["TC", 77],
        ["REQ", 34],
        ["VIEW", 69],
      ],
    );
    const ok = checkParity(
      { "docs/x.md": md },
      { cases: t(77, ["a", "b"]), requirements: t(34), perspectives: t(69) },
    );
    assert.deepEqual(ok.problems, []);
    const ng = checkParity(
      { "docs/x.md": md },
      { cases: t(76, ["a"]), requirements: t(34), perspectives: t(69) },
    );
    assert.match(ng.problems.join("\n"), /「77 件（TC）」だが cases.csv は 76 行/);
    assert.match(ng.problems.join("\n"), /cases.csv の列の記載が実際の列と違う/);
  });

  it("メール・トークン・秘密鍵を検出し、値は伏せる。UUID の 0 の並びは電話番号として数えない", () => {
    // 秘密情報らしい文字列は実行時に組み立てる（ソースに書くと、リポジトリ自身の gitleaks 検査が検出してしまう）
    const assignment = `${["to", "ken"].join("")} = "${["abcdef", "0123456789"].join("")}"`;
    const header = `-----BEGIN ${["RSA", "PRIVATE", "KEY"].join(" ")}-----`;
    const hits = scanText(
      `連絡: someone@example.org\n${assignment}\n${header}\nid 00000000-0000-4000-8000-000000000001`,
    );
    assert.deepEqual(
      hits.map((h) => [h.line, h.rule]),
      [
        [1, "email"],
        [2, "assignment"],
        [3, "private-key"],
      ],
    );
    assert.ok(hits.every((h) => !h.sample.includes("someone")));
    const { hits: none, qcCompat } = scanFiles([
      { path: "docs/data/x.csv", text: "00000000-0000-4000-8000-000000000001" },
    ]);
    assert.deepEqual(none, []);
    assert.equal(qcCompat.get("docs/data/x.csv"), 1);
    // 許可リストの例外は無い。SBOM のメンテナのメールも、墨消ししない限り検出する
    assert.deepEqual(
      scanFiles([{ path: "a/sbom.cdx.json", text: "maintainer@alpinelinux.org" }]).hits.map((h) => h.rule),
      ["email"],
    );
  });
});

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
