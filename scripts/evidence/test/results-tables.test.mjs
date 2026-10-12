// 性能層の実施行・run の役割台帳・手順からの逸脱の表・API 結果表。合成データで、ファイルを読まない純粋関数の検査。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { apiResultsParity, countByTest } from "../lib/api-parity.mjs";
import {
  API_RESULT_COLUMNS,
  apiResultByTc,
  buildApiResults,
  callsOf,
  flagsOfBlock,
  harnessProblems,
  mappingProblems,
  normalizePath,
  scanTestFlags,
  tagSupported,
  testBlocks,
  uncoveredCases,
} from "../lib/api-results.mjs";
import { createReport } from "../lib/common.mjs";
import {
  DEVIATION_COLUMNS,
  deviationParity,
  deviationRow,
  deviationRows,
  parseDeviationTable,
} from "../lib/deviations.mjs";
import { KINDS, checkActualResults, checkRows, checkSingleVersion } from "../lib/execution-checks.mjs";
import { mergeRows } from "../lib/execution-merge.mjs";
import { DERIVED_TABLES } from "../lib/evidence-files.mjs";
import { buildDerived, buildManifest, sameFiles, verifyManifest } from "../lib/manifest.mjs";
import { buildPerfRows, judgementText } from "../lib/perf-rows.mjs";
import { buildRunRoles, checkExecutionRuns, classifyRun } from "../lib/run-roles.mjs";
import { buildTraceability } from "../lib/traceability.mjs";

const X = "5".repeat(40);
const Y = "6".repeat(40);

// ---- 性能層の実施行 -----------------------------------------------------------------------

const judgement = (metric, mean, target, extra = {}) => ({
  metric,
  operator: "<=",
  target,
  unit: "ms",
  values: [mean - 1, mean, mean + 1],
  mean,
  pass: mean <= target,
  ...extra,
});

const perfCtx = (overrides = {}) => ({
  runId: "900",
  sha: X,
  run: {
    started_at: "2026-10-11T15:45:08.498Z",
    env_class: "github-hosted:ubuntu24:X64",
    profile: "ci",
    host: { os_release: "6.17.0", arch: "x64", node: "v24.0.0" },
  },
  verdicts: {
    load: {
      slo_judgements: [
        judgement("api_list_p95_ms", 19.5, 500),
        judgement("api_create_p95_ms", 18.4, 300),
        judgement("api_update_p95_ms", 15.9, 300),
      ],
    },
    screen: {
      iterations: 10,
      slo_judgements: [{ ...judgement("screen_ready_ms", 158.1, 2000), values: [158.1] }],
    },
  },
  slos: [
    { metric: "api_list_p95_ms", test_cases: ["TC-073"] },
    { metric: "api_create_p95_ms", test_cases: ["TC-073"] },
    { metric: "api_update_p95_ms", test_cases: ["TC-074"] },
    { metric: "screen_ready_ms", test_cases: ["TC-074"] },
    { metric: "health_p95_ms", test_cases: [] },
  ],
  caseIds: new Set(["TC-073", "TC-074"]),
  evidenceFor: (scenario) => ({ claim: `${scenario} の判定`, ref: `./perf/${scenario}/verdict.json` }),
  runEntry: { claim: "run.json", ref: "./perf/run.json" },
  ...overrides,
});

describe("性能層の実施行（kind=performance）", () => {
  it("SLO の test_cases でケースに結び付け、判定値から actual_result を作る（期待結果の転記でない）", () => {
    const rows = buildPerfRows(perfCtx());
    assert.deepEqual(
      rows.map((r) => [r.test_case_id, r.kind, r.run_ref, r.status, r.commit_sha]),
      [
        ["TC-073", "performance", "gh-run-900", "pass", X],
        ["TC-074", "performance", "gh-run-900", "pass", X],
      ],
    );
    assert.match(rows[0].actual_result, /api_list_p95_ms 19\.5ms（目標 <= 500ms、3 反復の平均。達成）/);
    assert.match(rows[0].actual_result, /api_create_p95_ms 18\.4ms/);
    assert.match(
      rows[1].actual_result,
      /screen_ready_ms 158\.1ms（目標 <= 2000ms、10 回の計測の p95。達成）/,
    );
    assert.equal(rows[0].executed_at, "2026-10-11T15:45:08.498Z");
    assert.match(rows[0].environment, /github-hosted:ubuntu24:X64.*profile ci.*Node v24\.0\.0/);
  });

  it("SLO を満たさない判定が 1 つでもあればその行は fail。TC に結び付かない SLO（test_cases が空）は行にしない", () => {
    const ctx = perfCtx();
    ctx.verdicts.load.slo_judgements[2] = judgement("api_update_p95_ms", 450, 300);
    const rows = buildPerfRows(ctx);
    assert.equal(rows.find((r) => r.test_case_id === "TC-074").status, "fail");
    assert.equal(rows.find((r) => r.test_case_id === "TC-073").status, "pass");
    assert.match(rows.find((r) => r.test_case_id === "TC-074").actual_result, /未達/);
    assert.equal(rows.length, 2);
  });

  it("cases.csv に無い TC は行にしない。判定が無いシナリオ（screen なし）の SLO は行に出ない", () => {
    const rows = buildPerfRows(perfCtx({ caseIds: new Set(["TC-073"]) }));
    assert.deepEqual(
      rows.map((r) => r.test_case_id),
      ["TC-073"],
    );
    const noScreen = perfCtx();
    delete noScreen.verdicts.screen;
    assert.doesNotMatch(
      buildPerfRows(noScreen).find((r) => r.test_case_id === "TC-074").actual_result,
      /screen_ready/,
    );
  });

  it("証拠はシナリオの verdict と run.json。実施表の検査（語彙・版・実測値）を通り、別 run は置き換えず追加される", () => {
    const rows = buildPerfRows(perfCtx());
    assert.deepEqual(
      rows[1]._evidence.map((e) => e.ref),
      ["./perf/load/verdict.json", "./perf/screen/verdict.json", "./perf/run.json"],
    );
    assert.ok(KINDS.includes("performance"));
    const withIds = rows.map((r, i) => ({ ...r, execution_id: `EXEC-000${i + 1}`, evidence_ids: "EV-0001" }));
    const report = createReport();
    checkRows(
      withIds,
      { caseIds: new Set(["TC-073", "TC-074"]), evidenceIds: new Set(["EV-0001"]), defectIds: new Set() },
      report,
    );
    checkActualResults(withIds, [{ test_case_id: "TC-073", expected_result: "x" }], report);
    checkSingleVersion(withIds, report, X);
    assert.deepEqual(report.errors, []);
    const existing = [
      {
        execution_id: "EXEC-0001",
        test_case_id: "TC-001",
        run_ref: "gh-run-1",
        commit_sha: X,
        environment: "e",
      },
    ];
    const merged = mergeRows({
      existing,
      built: rows,
      runRef: "gh-run-900",
      prune: false,
      report: createReport(),
    });
    assert.equal(merged.length, 3);
    assert.equal(merged[0].execution_id, "EXEC-0001");
  });

  it("judgementText は値・目標・根拠・達成の別を 1 文にする", () => {
    assert.equal(
      judgementText({
        metric: "m",
        mean: 12.345678,
        unit: "ms",
        operator: "<=",
        target: 500,
        basis: "3 反復の平均",
        pass: true,
      }),
      "m 12.35ms（目標 <= 500ms、3 反復の平均。達成）",
    );
  });
});

// ---- run の役割台帳 -----------------------------------------------------------------------

describe("run の役割台帳（対象版 / 履歴）", () => {
  it("対象版の commit で変更なしなら target。別の commit・未コミットの変更・置き換えられた run は history で、理由を持つ", () => {
    assert.equal(classifyRun({ sha: X, dirty: false, env: "github-hosted:x" }, X).role, "target");
    const other = classifyRun({ sha: Y, dirty: false, env: "local:darwin-arm64" }, X);
    assert.equal(other.role, "history");
    assert.match(other.reason, /別の commit/);
    assert.match(other.reason, /開発機/);
    assert.match(classifyRun({ sha: X, dirty: true }, X).reason, /未コミット/);
    const superseded = classifyRun({ sha: X, supersededReason: "取り替えた" }, X);
    assert.equal(superseded.role, "history");
    assert.match(superseded.reason, /取り替えた/);
  });

  it("開発機の実行でも、対象版の commit で変更なしなら target（環境が違うことだけでは履歴にしない）", () => {
    assert.equal(classifyRun({ sha: X, dirty: false, env: "local:darwin-arm64" }, X).role, "target");
  });

  it("取り込んだ run と開発機の性能 run から台帳を作る。同じ run の ci と security は別の項目", () => {
    const roles = buildRunRoles({
      sources: [
        { run_id: "1", kind: "ci", workflow: "Release", head_sha: X, path: "docs/evidence/runs/1" },
        { run_id: "1", kind: "security", workflow: "Release", head_sha: X, path: "docs/evidence/security" },
        {
          run_id: "0",
          kind: "ci",
          workflow: "CI",
          head_sha: Y,
          path: "docs/evidence/runs/0",
          superseded_by: { run_id: "1", head_sha: X },
        },
      ],
      perfRuns: [
        {
          run_id: "exp-1",
          commit_sha: Y,
          dirty: true,
          env_class: "local:darwin-arm64",
          path: "perf/results/exp-1",
        },
      ],
      targetSha: X,
    });
    assert.deepEqual(
      roles.map((r) => [r.run_ref, r.kind, r.role]),
      [
        ["gh-run-0", "ci", "history"],
        ["gh-run-1", "ci", "target"],
        ["gh-run-1", "security", "target"],
        ["perf-exp-1", "perf", "history"],
      ],
    );
  });

  it("実施表が履歴の run・台帳に無い run を参照していたら失敗にする", () => {
    const roles = [
      { run_ref: "gh-run-1", role: "target", reason: "" },
      { run_ref: "gh-run-0", role: "history", reason: "取り替えた" },
    ];
    const ok = createReport();
    checkExecutionRuns([{ run_ref: "gh-run-1" }, { run_ref: "gh-run-1" }], roles, ok);
    assert.deepEqual(ok.errors, []);
    const bad = createReport();
    checkExecutionRuns([{ run_ref: "gh-run-0" }, { run_ref: "gh-run-9" }], roles, bad);
    assert.equal(bad.errors.length, 2);
    assert.match(bad.errors[0], /履歴の run gh-run-0/);
    assert.match(bad.errors[1], /gh-run-9 が run-roles.yaml に無い/);
  });
});

// ---- 手順からの逸脱の表 -------------------------------------------------------------------

const DEV_MD = `# 09

| ID | 対象（実施 ID・ケース） | 代替手順（steps） | 差分 | 理由（reason） | 承認（approved_by。ロールと根拠） | 仕様書・計画への還流 |
|---|---|---|---|---|---|---|
| DEV-001 | EXEC-0104 TC-071（実機） | 実施せず not_run。**代えない** | 未確認 | 実機が無い | プロダクトオーナー（PR #41 のマージ） | plan-12 |
| DEV-002 | EXEC-0002 TC-001・EXEC-0079 TC-056（firefox の 2 行） | CI で実行 | 環境が違う | macOS で動かない | プロダクトオーナー（同上） | 同上 |
| DEV-003 | EXEC-0001〜EXEC-0111（全 111 行） | 基準を取り替えた | commit が変わった | 版を固定 | プロダクトオーナー（PR #42） | README |

本文の別の表:

| ID | 内容 |
|---|---|
| DEV-009 | 無関係 |
`;

describe("手順からの逸脱（docs/09 の DEV 表 → deviations.csv）", () => {
  it("DEV 表の行を読み、太字の記号だけを外す。別の表（見出しが違う）の行は拾わない", () => {
    const rows = parseDeviationTable(DEV_MD);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["DEV-001", "DEV-002", "DEV-003"],
    );
    assert.equal(rows[0].steps, "実施せず not_run。代えない");
    assert.equal(parseDeviationTable("表なし"), null);
  });

  it("execution_id は対象の先頭の実施 ID。複数にまたがる逸脱は、対象の全文を steps の先頭に残す。承認は表のとおり", () => {
    const [d1, d2, d3] = deviationRows(DEV_MD);
    assert.deepEqual(Object.keys(d1), DEVIATION_COLUMNS);
    assert.equal(d1.execution_id, "EXEC-0104");
    assert.equal(d2.execution_id, "EXEC-0002");
    assert.match(
      d2.steps,
      /^対象: EXEC-0002 TC-001・EXEC-0079 TC-056（firefox の 2 行）。代替手順: CI で実行。差分: 環境が違う$/,
    );
    assert.equal(d3.execution_id, "EXEC-0001");
    assert.equal(d2.approved_by, "プロダクトオーナー（同上）");
    assert.equal(
      deviationRow({ id: "DEV-X", target: "全件", steps: "a", diff: "b", reason: "c", approval: "d" })
        .execution_id,
      "",
    );
  });

  it("表と CSV の不一致（行の欠け・値の違い・列の違い・CSV なし）を検出する", () => {
    const table = { header: DEVIATION_COLUMNS, rows: deviationRows(DEV_MD) };
    assert.deepEqual(deviationParity("docs/09", DEV_MD, table), { checked: 3, problems: [] });
    const edited = { header: DEVIATION_COLUMNS, rows: table.rows.map((r) => ({ ...r })) };
    edited.rows[1].approved_by = "誰か";
    assert.match(
      deviationParity("docs/09", DEV_MD, edited).problems[0],
      /DEV-002 の approved_by が deviations.csv と違う/,
    );
    assert.match(
      deviationParity("docs/09", DEV_MD, { ...table, rows: table.rows.slice(1) }).problems.join("\n"),
      /3 件だが deviations.csv は 2 行/,
    );
    assert.match(
      deviationParity("docs/09", DEV_MD, { header: ["a"], rows: table.rows }).problems[0],
      /列が違う/,
    );
    assert.match(deviationParity("docs/09", DEV_MD, null).problems[0], /deviations.csv が無い/);
    assert.deepEqual(deviationParity("docs/09", "表なし", null), { checked: 0, problems: [] });
    assert.deepEqual(deviationParity("docs/09", undefined, null), { checked: 0, problems: [] });
  });
});

// ---- API 結果表 ---------------------------------------------------------------------------

const TEST_SOURCE = `
describe("x", () => {
  it("[TC-001] 追加は 201 で Location は付かない", async () => {
    const res = await api.post("/api/v1/tasks", { title: "a" });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get("location"), null);
  });

  it("[TC-002] 不正は 400", async () => {
    assertError(await api.post("/api/v1/tasks", {}), 400, "INVALID_REQUEST");
  });

  it("[TC-003] 性能", async () => {
    const api = await harness.start({ dbPath, contract: false });
    const res = await api.get("/api/v1/tasks");
    assert.ok(res.body.tasks.length === 1000);
  });

  it("[補助] ケース外", async () => {
    assert.equal(1, 1);
  });

  it("[TC-004] 一覧の形", async () => {
    const first = await api.get("/api/v1/tasks");
    assert.equal(first.status, 200);
    assert.match(first.headers.get("content-type"), /^application\\/json/);
  });
});
`;

describe("API 結果表: テスト実装の読み取り", () => {
  it("TC 付きの it だけを切り出す（[補助] は対象外）", () => {
    const blocks = testBlocks(TEST_SOURCE);
    assert.deepEqual(
      blocks.map((b) => b.tcs),
      [["TC-001"], ["TC-002"], ["TC-003"], ["TC-004"]],
    );
    assert.ok(!blocks[0].body.includes("TC-002"));
  });

  it("status・header のアサートと契約検証の有無を、テストの実装から読む", () => {
    const flags = scanTestFlags(new Map([["a.test.js", TEST_SOURCE]]));
    assert.deepEqual(flags.get("TC-001"), { status: true, header: true, schema: true, contentType: true });
    assert.deepEqual(flags.get("TC-002"), { status: true, header: false, schema: true, contentType: true });
    // contract: false なら契約スキーマも content-type（契約検証の中で見る）も検証しない。status のアサートも無い
    assert.deepEqual(flags.get("TC-003"), {
      status: false,
      header: false,
      schema: false,
      contentType: false,
    });
    // content-type の明示的なアサートは header には数えない（content-type 以外の header だけ）
    assert.deepEqual(flags.get("TC-004"), { status: true, header: false, schema: true, contentType: true });
  });

  it("同じ TC のテストが複数あるときは、すべてで成り立つときだけ true。contract: false でも content-type を明示的に見ていれば true", () => {
    const two = `
      it("[TC-009] a", async () => { assert.equal(res.status, 200); });
      it("[TC-009] b", async () => { await check(); });
      it("[TC-010] c", async () => { api.start({ contract: false }); assert.match(res.headers.get("Content-Type"), /json/); assert.equal(res.status, 200); });
    `;
    const flags = scanTestFlags(new Map([["b.test.js", two]]));
    assert.equal(flags.get("TC-009").status, false);
    assert.equal(
      flagsOfBlock(
        'it("[TC-010]", () => { api.start({ contract: false }); res.headers.get("content-type") })',
      ).contentTypeExplicit,
      true,
    );
    assert.equal(flags.get("TC-010").contentType, true);
    assert.equal(flags.get("TC-010").schema, false);
  });

  it("テスト基盤の前提（契約検証が既定で有効・content-type を見る）が崩れたら指摘する", () => {
    const harness =
      "export function createClient(baseUrl, { contract = true } = {}) { if (contract && options.contract !== false) assertContract(result, method, path); }";
    assert.deepEqual(harnessProblems(harness, "const ct = 'content-type';"), []);
    assert.equal(harnessProblems("createClient({ contract = false })", "x").length, 3);
  });
});

describe("API 結果表: 観察値の裏付けと表の組み立て", () => {
  const entry = (tc, calls, layer = "api") => ({
    _tc: tc,
    _file: `observations/backend/${tc}.json`,
    layer,
    api_calls: calls,
  });
  const err = (status, code) => ({
    method: "POST",
    path: "/api/v1/tasks",
    status,
    response: `{"error":{"code":"${code}"}}`,
  });
  const ok = (method, path, status) => ({ method, path, status, response: "{}" });
  const post201 = ok("POST", "/api/v1/tasks", 201);

  it("観察値の path は {id} に正規化し、api 層の呼び出しだけを使う", () => {
    assert.equal(normalizePath("/api/v1/tasks/{uuid}"), "/api/v1/tasks/{id}");
    assert.equal(normalizePath("/api/v1/tasks/abc"), "/api/v1/tasks/{id}");
    assert.equal(normalizePath("/api/v1/tasks"), "/api/v1/tasks");
    assert.equal(normalizePath("/api/v1/health"), "/api/v1/health");
    const calls = callsOf([
      entry("TC-001", [ok("get", "/api/v1/tasks", 200)]),
      entry("TC-001", [ok("GET", "/x", 200)], "unit"),
    ]);
    assert.deepEqual(calls, [{ method: "GET", endpoint: "/api/v1/tasks", status: 200, response: "{}" }]);
  });

  it("タグは観察値に裏付けがあるものだけ（実際に行っていない検査をタグにしない）", () => {
    const rejected = [{ status: 400, response: '{"error":{"code":"INVALID_REQUEST"}}' }];
    const accepted = [{ status: 201, response: "{}" }];
    assert.ok(tagSupported("error:4xx", rejected));
    assert.ok(!tagSupported("error:4xx", accepted));
    assert.ok(!tagSupported("error:5xx", rejected));
    assert.ok(tagSupported("error:error_code", rejected));
    assert.ok(!tagSupported("error:error_code", [{ status: 400, response: "(JSON でない本文)" }]));
    assert.ok(tagSupported("validation:required", rejected));
    assert.ok(!tagSupported("validation:required", accepted));
    assert.ok(tagSupported("validation:boundary", accepted));
    assert.ok(!tagSupported("idempotency", accepted));
    assert.ok(tagSupported("concurrency", [...accepted, ...accepted]));
    assert.ok(tagSupported("retry", [{ status: 503 }, { status: 201 }]));
    assert.ok(!tagSupported("retry", [{ status: 201 }, { status: 503 }]));
    assert.ok(!tagSupported("error:retryable", [{ status: 503 }]));
    assert.ok(!tagSupported("schema", [{ status: 500 }]));
  });

  const mapping = {
    tests: [
      { id: "TC-001", endpoints: [{ method: "POST", path: "/api/v1/tasks", tags: ["validation:boundary"] }] },
      {
        id: "TC-002",
        endpoints: [{ method: "POST", path: "/api/v1/tasks", tags: ["validation:required", "error:4xx"] }],
      },
    ],
  };
  const ctx = (over = {}) => ({
    mapping,
    statusByTc: new Map([
      ["TC-001", "pass"],
      ["TC-002", "fail"],
    ]),
    flagsByTc: new Map([
      ["TC-001", { status: true, header: true, schema: true, contentType: true }],
      ["TC-002", { status: true, header: false, schema: false, contentType: false }],
    ]),
    observations: new Map([
      ["backend", [entry("TC-001", [post201]), entry("TC-002", [err(400, "INVALID_REQUEST")])]],
    ]),
    runId: "gh-run-1",
    runDir: "./docs/evidence/runs/1",
    ...over,
  });

  it("行は列の順で、テスト × endpoint ごと。結果は JUnit、アサートは実装、evidence_ref は観察値のファイル", () => {
    const { rows, problems } = buildApiResults(ctx());
    assert.deepEqual(problems, []);
    assert.deepEqual(Object.keys(rows[0]), API_RESULT_COLUMNS);
    assert.deepEqual(rows[0], {
      test_id: "TC-001",
      endpoint: "/api/v1/tasks",
      method: "POST",
      tags: "validation:boundary",
      status: "pass",
      schema_validated: "true",
      asserts_status: "true",
      asserts_header: "true",
      asserts_content_type: "true",
      evidence_ref: "./docs/evidence/runs/1/observations/backend/TC-001.json",
      run_id: "gh-run-1",
    });
    assert.equal(rows[1].tags, "validation:required;error:4xx");
    assert.equal(rows[1].status, "fail");
    assert.equal(rows[1].schema_validated, "false");
  });

  it("観察値に無い endpoint・裏付けの無いタグ・結果や実装が見つからないテストは問題にする", () => {
    const noCall = buildApiResults(
      ctx({ observations: new Map([["backend", [entry("TC-001", []), entry("TC-002", [err(400, "X")])]]]) }),
    );
    assert.match(
      noCall.problems.join("\n"),
      /TC-001 POST \/api\/v1\/tasks: 観察値にこの endpoint の呼び出しが無い/,
    );
    const noTag = buildApiResults(
      ctx({ observations: new Map([["backend", [entry("TC-001", [post201]), entry("TC-002", [post201])]]]) }),
    );
    assert.match(
      noTag.problems.join("\n"),
      /TC-002 POST \/api\/v1\/tasks: タグ validation:required の裏付けが観察値に無い/,
    );
    const missing = buildApiResults(ctx({ statusByTc: new Map(), flagsByTc: new Map() }));
    assert.match(missing.problems.join("\n"), /TC-001: JUnit に API 層の結果が無い/);
    assert.match(missing.problems.join("\n"), /\[TC-001\] のテストが見つからない/);
  });

  it("JUnit の API 層の結果を TC ごとにまとめる（失敗が 1 件でもあれば fail。unit・e2e は含めない）", () => {
    const classify = (c) => ({ layer: c.layer, component: c.component });
    const status = apiResultByTc(
      [
        { name: "[TC-001] a", status: "passed", layer: "api", component: "backend" },
        { name: "[TC-001] b", status: "failed", layer: "api", component: "backend" },
        { name: "[TC-002] c", status: "passed", layer: "api", component: "backend" },
        { name: "[TC-003] d", status: "passed", layer: "unit", component: "backend" },
        { name: "[TC-004] e", status: "passed", layer: "e2e", component: "e2e" },
      ],
      classify,
    );
    assert.deepEqual(
      [...status.entries()],
      [
        ["TC-001", "fail"],
        ["TC-002", "pass"],
      ],
    );
  });

  it("対応表の形式（重複・cases.csv に無い TC・endpoint なし）と、対応表に無い API 層のケースを指摘する", () => {
    const caseIds = new Set(["TC-001", "TC-002"]);
    assert.deepEqual(mappingProblems(mapping, caseIds), []);
    const bad = {
      tests: [
        { id: "TC-001", endpoints: [{ method: "POST", tags: [] }] },
        { id: "TC-001", endpoints: [] },
        { id: "TC-999", endpoints: [{ method: "GET", path: "/x", tags: "no" }] },
      ],
    };
    const problems = mappingProblems(bad, caseIds).join("\n");
    assert.match(problems, /TC-001 が重複/);
    assert.match(problems, /TC-999 が cases.csv に無い/);
    assert.match(problems, /method \/ path が無い/);
    assert.match(problems, /endpoints が無い/);
    assert.match(problems, /tags が配列でない/);
    assert.deepEqual(
      uncoveredCases(
        [
          { test_case_id: "TC-001", automation_layer: "api" },
          { test_case_id: "TC-005", automation_layer: "api" },
          { test_case_id: "TC-006", automation_layer: "e2e" },
        ],
        mapping,
      ),
      ["TC-005: API 層のケースだが api-tags.yaml に無い（api-results.csv に載らない）"],
    );
  });
});

describe("API 結果表: docs/06 の数字との一致・追跡表・manifest", () => {
  const rows = [
    {
      test_id: "TC-001",
      schema_validated: "true",
      asserts_status: "true",
      asserts_header: "true",
      asserts_content_type: "true",
    },
    {
      test_id: "TC-001",
      schema_validated: "true",
      asserts_status: "true",
      asserts_header: "false",
      asserts_content_type: "true",
    },
    {
      test_id: "TC-002",
      schema_validated: "false",
      asserts_status: "true",
      asserts_header: "false",
      asserts_content_type: "false",
    },
  ];
  const md = `
| 検査 | 件数 | 備考 |
|---|---|---|
| status のアサート | 2 / 2 | x |
| 契約スキーマでの本文検証 | 1 / 2 | y |
| content-type の検証 | 1 / 2 | z |
| content-type 以外の header のアサート | 0 / 2 | w |
`;

  it("テスト単位（その TC のすべての行で true）で数え、md の「N / M」と突き合わせる", () => {
    const c = countByTest(rows);
    assert.equal(c.total, 2);
    assert.equal(c.count("asserts_header"), 0);
    assert.equal(c.count("asserts_status"), 2);
    assert.deepEqual(apiResultsParity("docs/06", md, { rows }), { checked: 4, problems: [] });
    const wrong = md.replace("| status のアサート | 2 / 2 |", "| status のアサート | 1 / 2 |");
    assert.match(
      apiResultsParity("docs/06", wrong, { rows }).problems[0],
      /「status のアサート 1 \/ 2」だが.*asserts_status は 2 \/ 2/,
    );
    assert.match(apiResultsParity("docs/06", md, null).problems[0], /api-results.csv が無い/);
    assert.deepEqual(apiResultsParity("docs/06", "数字なし", { rows }), { checked: 0, problems: [] });
  });

  it("追跡表: API 層のケースに api-results の行が無ければ gaps に出す。表が無い（null）ときは見ない", () => {
    const tables = (apiResults) => ({
      requirements: [],
      risks: [],
      perspectives: [],
      cases: [
        { test_case_id: "TC-001", automation_layer: "api" },
        { test_case_id: "TC-002", automation_layer: "api" },
        { test_case_id: "TC-003", automation_layer: "e2e" },
      ],
      executions: ["TC-001", "TC-002", "TC-003"].map((id) => ({
        test_case_id: id,
        execution_id: `E-${id}`,
        status: "pass",
      })),
      defects: [],
      findings: [],
      actions: [],
      apiResults,
    });
    const withTable = buildTraceability(tables([{ test_id: "TC-001" }]));
    assert.equal(withTable.find((r) => r.test_case_id === "TC-001").gaps, "");
    assert.equal(
      withTable.find((r) => r.test_case_id === "TC-002").gaps,
      "API 結果の行なし（api-results.csv）",
    );
    assert.equal(withTable.find((r) => r.test_case_id === "TC-003").gaps, "");
    assert.ok(buildTraceability(tables(null)).every((r) => r.gaps === ""));
  });

  it("manifest: 派生表（api-results.csv・deviations.csv）の sha256 を記録し、書き換えを検知する。内容が同じなら書き換えない", () => {
    const root = mkdtempSync(join(tmpdir(), "derived-"));
    try {
      mkdirSync(join(root, "docs/data"), { recursive: true });
      mkdirSync(join(root, "docs/evidence"), { recursive: true });
      for (const t of DERIVED_TABLES) writeFileSync(join(root, t.path), "a,b\n1,2\n");
      const derived = buildDerived(root);
      assert.deepEqual(
        derived.map((d) => d.path),
        ["docs/data/api-results.csv", "docs/data/deviations.csv"],
      );
      assert.match(derived[0].generated_by, /build-api-results\.mjs$/);
      const manifest = buildManifest([], "2026-10-12T00:00:00Z", derived);
      assert.deepEqual(verifyManifest(join(root, "docs/evidence"), manifest, root), []);
      assert.ok(sameFiles(manifest, [], derived));
      writeFileSync(join(root, "docs/data/api-results.csv"), "a,b\n9,9\n");
      assert.match(
        verifyManifest(join(root, "docs/evidence"), manifest, root)[0],
        /sha256 不一致（派生表.*api-results\.csv/,
      );
      assert.ok(!sameFiles(manifest, [], buildDerived(root)));
      rmSync(join(root, "docs/data/deviations.csv"));
      assert.match(
        verifyManifest(join(root, "docs/evidence"), manifest, root).join("\n"),
        /欠落（派生表）: docs\/data\/deviations\.csv/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
