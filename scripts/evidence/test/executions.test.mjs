// 実施表の組み立て・統合・検査。合成の JUnit ケースと観察値で、固定の時刻（clock を持たない純粋関数）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createReport } from "../lib/common.mjs";
import {
  checkActualResults,
  checkAgainstSummary,
  checkObservationRun,
  checkRows,
  checkSingleVersion,
} from "../lib/execution-checks.mjs";
import { assignIds, mergeRows } from "../lib/execution-merge.mjs";
import { buildRunRows } from "../lib/execution-rows.mjs";
import { classify, combineStatus, compareRows, groupCases } from "../lib/executions.mjs";
import { createRegistry } from "../lib/evidence-registry.mjs";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

const testCases = [
  {
    test_case_id: "TC-001",
    automation_layer: "e2e",
    expected_result: "一覧に 1 件増え、入力欄は空になり、エラー文言は表示されない（期待結果の文）",
  },
  { test_case_id: "TC-002", automation_layer: "api", expected_result: "400 を返す" },
  { test_case_id: "TC-003", automation_layer: "unit", expected_result: "合格する" },
  { test_case_id: "TC-071", automation_layer: "manual", expected_result: "読み上げられる" },
  { test_case_id: "TC-004", automation_layer: "api", expected_result: "未実装のケース" },
];

const junit = (name, source, extra = {}) => ({
  name,
  classname: "c",
  file: "",
  time: 0.5,
  suite: "s",
  hostname: "chromium",
  timestamp: "2026-10-11T08:00:00.000Z",
  source,
  status: "passed",
  message: "",
  ...extra,
});

const junitCases = [
  junit("[TC-001] 追加", "junit/e2e-chromium-junit.xml"),
  junit("[TC-002] 検証", "junit/backend-junit.xml", {
    file: "/x/backend/test/api/a.test.js",
    hostname: "h",
    status: "failed",
    message: "boom",
  }),
  junit("[TC-003] 単体", "junit/frontend-junit.xml", { hostname: "h" }),
];

const observations = new Map([
  [
    "e2e",
    [
      {
        title: "[TC-001] 追加",
        _tc: "TC-001",
        _file: "observations/e2e/TC-001.chromium.json",
        _sha: "1".repeat(64),
        layer: "e2e",
        project: "chromium",
        started_at: "2026-10-11T08:00:01.000Z",
        environment: {
          browser: "chromium 156",
          viewport: { width: 1280, height: 800 },
          os: "Linux 6 x64",
          node: "v24.0.0",
        },
        screen: {
          row_count: 1,
          rows: [{ text: "買い物", checked: false, busy: false }],
          rows_omitted: 0,
          input_value: "",
          save_error: "",
          input_error: "",
          list_message: "",
          focus: null,
        },
        api_calls: [{ method: "POST", path: "/api/v1/tasks", status: 201 }],
        notes: [],
        table: [],
      },
    ],
  ],
]);

function context(over = {}) {
  const report = createReport();
  const registry = createRegistry();
  return {
    ctx: {
      testCases,
      junitCases,
      junitShas: new Map(junitCases.map((c) => [c.source, "2".repeat(64)])),
      observations,
      runId: "123",
      runRef: "gh-run-123",
      sha: SHA,
      kind: "regression",
      executor: "GitHub Actions",
      startedAt: "2026-10-11T07:59:00.000Z",
      capturedAt: "2026-10-11T09:00:00.000Z",
      selection: { mode: "full" },
      manual: new Map([
        ["TC-071", { environment: "実機", reason: "実機が無い", owner: "QA 担当", retest_due: "2026-10-31" }],
      ]),
      gaps: new Map(),
      defectsByTc: new Map([["TC-002", ["DEF-002"]]]),
      verifiedByTc: new Map([["TC-003", ["DEF-003"]]]),
      retestDue: "2026-10-20",
      report,
      ...over,
    },
    report,
    registry,
  };
}

const build = (over) => {
  const c = context(over);
  const rows = buildRunRows(c.ctx).sort(compareRows);
  for (const r of rows) r.evidence_ids = (r._evidence ?? []).map((e) => c.registry.allocate(e)).join(";");
  return { rows, ...c };
};

describe("実施行の組み立て", () => {
  it("結果のある行: 観察値から actual_result を作り、fail は不具合に接続し、証拠を EV に解決する", () => {
    const { rows, registry } = build();
    const e2e = rows.find((r) => r.test_case_id === "TC-001");
    assert.equal(e2e.status, "pass");
    assert.equal(e2e.kind, "regression");
    assert.equal(e2e.commit_sha, SHA);
    assert.equal(e2e.executed_at, "2026-10-11T08:00:01.000Z");
    assert.match(e2e.actual_result, /一覧 1 行 \[買い物\]/);
    assert.match(e2e.environment, /e2e\/chromium \/ chromium 156 \/ 1280x800/);
    assert.equal(e2e.evidence_ids.split(";").length, 2);
    assert.equal(registry.rows()[0].ref, "./docs/evidence/runs/123/junit/e2e-chromium-junit.xml#TC-001");
    const failed = rows.find((r) => r.test_case_id === "TC-002");
    assert.equal(failed.status, "fail");
    assert.equal(failed.defect_ids, "DEF-002");
    assert.match(failed.actual_result, /観察値なし.*失敗の内容: boom/);
    // pass の行は、この版に修正が入った不具合の修正確認として接続する（関連ケースを修正版で再実施して pass）
    assert.equal(rows.find((r) => r.test_case_id === "TC-003").defect_ids, "DEF-003");
    assert.equal(e2e.defect_ids, "");
  });

  it("全ケースが少なくとも 1 行: 手動は not_run（理由・owner・予定日つき）、結果の無い自動化ケースも not_run", () => {
    const { rows } = build();
    assert.deepEqual([...new Set(rows.map((r) => r.test_case_id))].sort(), [
      "TC-001",
      "TC-002",
      "TC-003",
      "TC-004",
      "TC-071",
    ]);
    const manual = rows.find((r) => r.test_case_id === "TC-071");
    assert.deepEqual(
      [manual.kind, manual.status, manual.reason, manual.owner, manual.retest_due],
      ["manual", "not_run", "実機が無い", "QA 担当", "2026-10-31"],
    );
    assert.equal(manual.executed_at, "");
    const missing = rows.find((r) => r.test_case_id === "TC-004");
    assert.deepEqual(
      [missing.status, missing.owner, missing.retest_due],
      ["not_run", "QA 担当", "2026-10-20"],
    );
    assert.match(missing.reason, /JUnit に TC-004 の結果が無い/);
  });

  it("選択実行で選ばれなかったケースは skipped（理由つき）", () => {
    const { rows } = build({
      selection: {
        mode: "selected",
        selected_case_ids: ["TC-001", "TC-002", "TC-003"],
        selection_reason: ["変更影響で選択"],
      },
    });
    assert.equal(rows.find((r) => r.test_case_id === "TC-004").status, "skipped");
  });

  it("手動ケースの実施計画が無ければ失敗、cases.csv に無い TC の結果も失敗", () => {
    const a = context({ manual: new Map() });
    buildRunRows(a.ctx);
    assert.match(a.report.errors.join("\n"), /TC-071 の実施計画が無い/);
    const b = context({ junitCases: [...junitCases, junit("[TC-999] 謎", "junit/frontend-junit.xml")] });
    buildRunRows(b.ctx);
    assert.match(b.report.errors.join("\n"), /cases.csv に無い TC-ID の結果: TC-999/);
  });

  it("層・環境の分類と、複数ケースの状態の合成", () => {
    assert.equal(classify(junitCases[0]).label, "e2e/chromium");
    assert.equal(classify(junitCases[1]).label, "api");
    assert.equal(classify(junit("x", "junit/compose-junit.xml")).layer, "compose");
    assert.equal(classify(junit("x", "junit/contract-junit.xml")).layer, "contract");
    assert.equal(combineStatus([junit("a", "s"), junit("b", "s", { status: "failed" })]), "fail");
    assert.equal(combineStatus([junit("a", "s", { status: "skipped" })]), "skipped");
    assert.equal(groupCases([junit("[TC-001] [TC-002] 両方", "junit/frontend-junit.xml")]).length, 2);
  });
});

describe("統合と冪等性", () => {
  const base = (sha, ref) => ({
    test_case_id: "TC-001",
    run_ref: ref,
    environment: "e2e/chromium",
    commit_sha: sha,
    execution_id: "",
  });

  it("同じ run の行は置き換え、ID は同じ行なら引き継ぐ。再生成しても同じ", () => {
    const first = assignIds(
      mergeRows({
        existing: [],
        built: [base(SHA, "gh-run-1"), { ...base(SHA, "gh-run-1"), environment: "e2e/webkit" }],
        runRef: "gh-run-1",
        prune: false,
        report: createReport(),
      }),
    );
    assert.deepEqual(
      first.map((r) => r.execution_id),
      ["EXEC-0001", "EXEC-0002"],
    );
    const again = assignIds(
      mergeRows({
        existing: first,
        built: [base(SHA, "gh-run-1"), { ...base(SHA, "gh-run-1"), environment: "e2e/webkit" }],
        runRef: "gh-run-1",
        prune: false,
        report: createReport(),
      }),
    );
    assert.deepEqual(again, first);
  });

  it("別の版の行が残るときは失敗する（版の混在）。--prune-other-versions なら捨てる", () => {
    const existing = [{ ...base(OTHER_SHA, "gh-run-0"), execution_id: "EXEC-0001" }];
    const report = createReport();
    mergeRows({ existing, built: [base(SHA, "gh-run-1")], runRef: "gh-run-1", prune: false, report });
    assert.match(report.errors[0], /別の版/);
    const pruned = mergeRows({
      existing,
      built: [base(SHA, "gh-run-1")],
      runRef: "gh-run-1",
      prune: true,
      report: createReport(),
    });
    assert.equal(pruned.length, 1);
    assert.equal(pruned[0].commit_sha, SHA);
  });
});

describe("実施表の検査", () => {
  it("期待結果の転記（完全一致）は失敗、短すぎ・全文を含むものは警告", () => {
    const report = createReport();
    checkActualResults(
      [
        { test_case_id: "TC-002", status: "pass", actual_result: " 400を 返す " },
        { test_case_id: "TC-003", status: "pass", actual_result: "ok" },
        {
          test_case_id: "TC-001",
          status: "pass",
          actual_result:
            "観察: 一覧に 1 件増え、入力欄は空になり、エラー文言は表示されない（期待結果の文） でした",
        },
      ],
      testCases,
      report,
    );
    assert.match(report.errors.join("\n"), /TC-002 の actual_result が期待結果と同一/);
    assert.match(report.warnings.join("\n"), /TC-003 の actual_result が短すぎる/);
    assert.match(report.warnings.join("\n"), /TC-001 の actual_result が期待結果の全文を含む/);
  });

  it("版の混在と、リリース SHA との不一致を検出する", () => {
    const a = createReport();
    checkSingleVersion([{ commit_sha: SHA }, { commit_sha: OTHER_SHA }], a);
    assert.match(a.errors[0], /2 種類混在/);
    const b = createReport();
    checkSingleVersion([{ commit_sha: SHA }], b, OTHER_SHA);
    assert.match(b.errors[0], /異なる版/);
    const c = createReport();
    checkSingleVersion([{ commit_sha: SHA }], c, SHA.slice(0, 7));
    assert.deepEqual(c.errors, []);
  });

  it("観察値が別の run のもの、JUnit の件数が ci-summary と違うものを検出する（取り込み漏れ・混入）", () => {
    const a = createReport();
    checkObservationRun(
      new Map([["e2e", [{ _file: "f.json", run: { commit_sha: OTHER_SHA, run_id: "9" } }]]]),
      { sha: SHA, runId: "123" },
      a,
    );
    assert.match(a.errors[0], /版・run が取り込んだ run と違う/);
    const local = createReport();
    checkObservationRun(
      new Map([["e2e", [{ _file: "f.json", run: { commit_sha: "local", run_id: "local" } }]]]),
      { sha: SHA, runId: "123" },
      local,
    );
    assert.deepEqual(local.errors, []);
    const b = createReport();
    checkAgainstSummary(
      junitCases,
      { layers: { e2e: { total: 1 }, api: { total: 2 }, unit: { total: 1 } } },
      b,
    );
    assert.match(b.errors.join("\n"), /層 api の件数が ci-summary と違う（JUnit 1 \/ ci-summary 2）/);
  });

  it("行の規則: 語彙・SHA・ISO 日時・証拠・未実施の三点・参照の解決・全ケースの行", () => {
    const { rows } = build();
    rows.forEach((r, i) => (r.execution_id = `EXEC-${String(i + 1).padStart(4, "0")}`));
    const ctx = {
      caseIds: new Set(testCases.map((c) => c.test_case_id)),
      evidenceIds: new Set(rows.flatMap((r) => r.evidence_ids.split(";")).filter(Boolean)),
      defectIds: new Set(["DEF-002", "DEF-003"]),
    };
    const ok = createReport();
    checkRows(rows, ctx, ok);
    assert.deepEqual(ok.errors, []);
    const bad = createReport();
    checkRows(
      [
        { ...rows[0], status: "PASS", commit_sha: "abc", executed_at: "昨日", evidence_ids: "EV-9999" },
        { ...rows.at(-1), status: "not_run", reason: "", owner: "" },
      ],
      { ...ctx, caseIds: new Set([...ctx.caseIds, "TC-500"]) },
      bad,
    );
    const text = bad.errors.join("\n");
    assert.match(text, /status が語彙外/);
    assert.match(text, /commit_sha が 40 桁/);
    assert.match(text, /証拠 EV-9999 が証拠索引に無い/);
    assert.match(text, /not_run の reason \/ owner \/ retest_due が揃っていない/);
    assert.match(text, /TC-500 の実施行が 1 行も無い/);
  });
});
