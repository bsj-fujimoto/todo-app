// 追跡表・アクション表・検出表（owner・due の補完・仮 ID の解決）。一時ディレクトリと合成データで確かめる。
import assert from "node:assert/strict";
import { checkActions } from "../lib/actions.mjs";
import { createReport } from "../lib/common.mjs";
import { findingRows } from "../lib/findings-table.mjs";
import { toFndId } from "../lib/findings.mjs";
import { checkReferences } from "../lib/id-check.mjs";
import { buildTraceability } from "../lib/traceability.mjs";
import { useTmpCleanup } from "./helpers.mjs";
import { describe, it } from "node:test";

useTmpCleanup();

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

describe("検出表の owner・due の補完", () => {
  const finding = {
    finding_id: "FND-012",
    fingerprint: "ccc",
    severity: "medium",
    status: "untriaged",
    tool: "gitleaks",
    rule_id: "sourcegraph-access-token",
    location: "docs/evidence/security/x.sarif:1351",
  };
  const triage = [
    {
      match: { tool: "gitleaks", rule_id: "sourcegraph-access-token", location: "docs/**" },
      status: "fp",
      owner: "セキュリティ担当",
      due: "2026-10-19",
    },
    { match: { tool: "owasp-zap", rule_id: "100001" }, status: "na" },
  ];

  it("run の出力に owner・due が無く、現在の台帳に同じ検出の記載があれば補う。status など run の判定は変えない", () => {
    const [row] = findingRows({ findings: [finding] }, new Map(), triage);
    assert.deepEqual([row.owner, row.due, row.status], ["セキュリティ担当", "2026-10-19", "untriaged"]);
  });

  it("run の出力に値があれば上書きしない。台帳に owner・due が無ければ空のまま（作り話を足さない）", () => {
    const [kept] = findingRows(
      { findings: [{ ...finding, owner: "バックエンド担当", due: "2026-12-31" }] },
      new Map(),
      triage,
    );
    assert.deepEqual([kept.owner, kept.due], ["バックエンド担当", "2026-12-31"]);
    const [blank] = findingRows(
      { findings: [{ ...finding, fingerprint: "ddd", tool: "owasp-zap", rule_id: "100001", location: "u" }] },
      new Map(),
      triage,
    );
    assert.deepEqual([blank.owner, blank.due], ["", ""]);
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
