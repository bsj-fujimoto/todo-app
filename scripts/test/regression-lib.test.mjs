// scripts/regression/lib の単体テスト。実行: node --test "scripts/test/*.test.mjs"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJunit } from "../ci/lib/junit.mjs";
import { analyze, buildReport, isFlaky, validateLedger } from "../regression/lib/flaky.mjs";
import { evaluateHealth, summarizeRuns } from "../regression/lib/health.mjs";
import { checkImpactMap } from "../regression/lib/impact-check.mjs";
import { select, validateMap } from "../regression/lib/impact.mjs";
import { buildRows, validateJourneys } from "../regression/lib/suite.mjs";

const cases = [
  {
    test_case_id: "TC-001",
    automation_layer: "e2e",
    risk_ids: "RISK-001",
    priority: "high",
    requirement_ids: "REQ-001",
    perspective_ids: "VIEW-001",
    manual_reason: "",
  },
  {
    test_case_id: "TC-002",
    automation_layer: "api",
    risk_ids: "RISK-002",
    priority: "medium",
    requirement_ids: "REQ-002",
    perspective_ids: "VIEW-002",
    manual_reason: "",
  },
  {
    test_case_id: "TC-003",
    automation_layer: "unit",
    risk_ids: "RISK-002",
    priority: "low",
    requirement_ids: "REQ-003",
    perspective_ids: "VIEW-003",
    manual_reason: "",
  },
  {
    test_case_id: "TC-004",
    automation_layer: "manual",
    risk_ids: "RISK-003",
    priority: "low",
    requirement_ids: "REQ-004",
    perspective_ids: "VIEW-004",
    manual_reason: "実機",
  },
];
const map = {
  smoke_case_ids: ["TC-001"],
  entries: [
    { id: "api", feature: "api", paths: ["backend/src/**"], case_ids: ["TC-002"], excluded_risk: "画面" },
    { id: "ci", feature: "ci", paths: [".github/workflows/ci.yml"], case_ids: [], full: true },
  ],
  no_test_impact: [{ id: "docs", reason: "docs", paths: ["docs/**", "**/*.md"] }],
};

describe("select（変更影響による選択）", () => {
  it("当たったエントリ + smoke だけを選び、理由と除外リスクを返す", () => {
    const r = select({ map, files: ["backend/src/app.js"], cases });
    assert.equal(r.mode, "selected");
    assert.deepEqual(r.selected_case_ids, ["TC-001", "TC-002"]);
    assert.match(r.selection_reason[0], /backend\/src\/app\.js → api/);
    assert.ok(r.excluded_risks.some((x) => x.risk_id === "RISK-002" && x.excluded_cases.includes("TC-003")));
    assert.equal(r.name_pattern_unit_api, "\\[(?:TC-002)\\]");
    assert.equal(r.grep_e2e, "\\[(?:TC-001)\\]|@smoke");
  });

  it("マップに無いパスがあれば全件にフォールバックする", () => {
    const r = select({ map, files: ["backend/src/app.js", "unknown/file.txt"], cases });
    assert.equal(r.mode, "full");
    assert.deepEqual(r.unmapped_paths, ["unknown/file.txt"]);
    assert.deepEqual(r.selected_case_ids, ["TC-001", "TC-002", "TC-003"]);
  });

  it("full: true のエントリ・空の差分も全件、ドキュメントだけなら smoke のみ", () => {
    assert.equal(select({ map, files: [".github/workflows/ci.yml"], cases }).mode, "full");
    assert.equal(select({ map, files: [], cases }).mode, "full");
    const docs = select({ map, files: ["docs/a.md"], cases });
    assert.equal(docs.mode, "selected");
    assert.deepEqual(docs.selected_case_ids, ["TC-001"]);
  });

  it("不正なマップを検出する", () => {
    assert.ok(validateMap({ entries: [{ id: "x", paths: [] }] }).length > 0);
    assert.deepEqual(validateMap(map), []);
  });
});

describe("impact-check（マップの陳腐化検査）", () => {
  it("当たらない追跡ファイル・選ばれないケース・古い glob を検出する", () => {
    const r = checkImpactMap({ map, files: ["backend/src/a.js", "x/y.txt"], cases });
    assert.ok(r.errors.some((e) => e.includes("x/y.txt")));
    assert.ok(r.errors.some((e) => e.includes("TC-003")));
    assert.ok(r.warnings.some((w) => w.includes("docs/**")));
  });
});

const XML = (name, results) =>
  `<testsuite>${results.map((s) => `<testcase name="${name}" classname="c">${s === "fail" ? "<failure/>" : ""}</testcase>`).join("")}</testsuite>`;

describe("flaky 検出と隔離台帳", () => {
  it("pass と fail が混在したテストだけを flaky とし、台帳外なら Issue 候補にする", () => {
    const xml =
      XML("[TC-045] 保存失敗", ["pass", "fail", "pass"]) + XML("[TC-046] 常時失敗", ["fail", "fail"]);
    const tests = analyze(parseJunit(xml, "e2e/test-results/junit.xml"));
    assert.deepEqual(
      tests.filter(isFlaky).map((t) => t.tc_ids),
      [["TC-045"]],
    );
    const report = buildReport({
      tests,
      ledger: [],
      today: "2026-10-11",
      sha: "abc",
      nowIso: "2026-10-11T00:00:00Z",
    });
    assert.equal(report.result, "fail");
    assert.equal(report.issue_candidates[0].labels[0], "flaky");
    assert.equal(report.consistent_failures.length, 1);
  });

  it("台帳は必須項目・期限・隔離日数・retry を検査する", () => {
    const ok = {
      test_id: "TC-045",
      rate: 0.1,
      cause: "c",
      owner: "o",
      since: "2026-10-01",
      expires_at: "2026-10-20",
    };
    assert.deepEqual(validateLedger([ok], "2026-10-11"), []);
    assert.equal(validateLedger([{ ...ok, expires_at: "2026-10-05" }], "2026-10-11").length, 1);
    assert.equal(validateLedger([{ ...ok, expires_at: "2026-12-30" }], "2026-10-11").length, 1);
    assert.equal(validateLedger([{ ...ok, retries: 2 }], "2026-10-11").length, 1);
    assert.equal(validateLedger([{ test_id: "TC-1" }], "2026-10-11").length, 1);
  });

  it("全て pass なら台帳が空でも pass", () => {
    const tests = analyze(parseJunit(XML("[TC-001] a", ["pass", "pass", "pass"]), "e2e/x.xml"));
    const r = buildReport({ tests, ledger: [], today: "2026-10-11", sha: "abc", nowIso: "n" });
    assert.equal(r.result, "pass");
  });
});

describe("健全性トレンド", () => {
  const run = (conclusion, start, end) => ({
    conclusion,
    run_started_at: start,
    updated_at: end,
    created_at: start,
  });
  it("成功率・所要時間・連続失敗を集計し、閾値超過を問題として返す", () => {
    const runs = [
      run("failure", "2026-10-11T00:00:00Z", "2026-10-11T00:10:00Z"),
      run("failure", "2026-10-10T00:00:00Z", "2026-10-10T00:10:00Z"),
      run("success", "2026-10-09T00:00:00Z", "2026-10-09T00:05:00Z"),
      run("cancelled", "2026-10-08T00:00:00Z", "2026-10-08T00:01:00Z"),
    ];
    const s = summarizeRuns("ci.yml", runs);
    assert.equal(s.cancelled, 1);
    assert.equal(s.success_rate, 0.333);
    assert.equal(s.consecutive_failures, 2);
    assert.equal(s.duration_sec.median, 300);
    const problems = evaluateHealth(s, {
      min_success_rate: 0.9,
      max_consecutive_failures: 2,
      max_p95_sec: 100,
    });
    assert.equal(problems.length, 3);
  });
});

describe("回帰スイート台帳", () => {
  it("tier・ジャーニー・status を決め、自動化ケースの無いジャーニーを検出する", () => {
    const journeys = [{ id: "J-01", name: "n", owner: "o", on_failure: "f", case_ids: ["TC-001", "TC-002"] }];
    const rows = buildRows({
      cases,
      journeys,
      smokeIds: ["TC-001"],
      quarantinedIds: new Set(["TC-002"]),
      defects: new Map([["TC-002", ["DEF-001"]]]),
    });
    assert.deepEqual(
      rows.map((r) => r.tier),
      ["smoke", "pr", "daily", "manual"],
    );
    assert.equal(rows[0].journey_id, "J-01");
    assert.equal(rows[1].status, "quarantined");
    assert.equal(rows[1].defect_ids, "DEF-001");
    assert.equal(rows[3].status, "manual");
    const bad = [{ id: "J-09", name: "n", owner: "o", on_failure: "f", case_ids: ["TC-004"] }];
    assert.equal(validateJourneys({ journeys: bad, cases }).length, 1);
  });
});
