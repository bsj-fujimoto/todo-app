// 検査ラウンド 2 の変更（scan-run の完全性・台帳の適用時点・IaC の分類・Fastify の規約・実行層・所要時間・結果ファイルの検証・性能ルール）の単体テスト。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { mergeSummaries, runInfo } from "../ci/lib/summary.mjs";
import { elapsedSec, jobTimings, layerTimings } from "../ci/lib/timing.mjs";
import { evaluateHealth, summarizeRuns } from "../regression/lib/health.mjs";
import { tiersOf, workflowTiers } from "../regression/lib/tiers.mjs";
import { triageSource } from "../evidence/lib/triage-source.mjs";
import { planRunFiles } from "../evidence/lib/run-layout.mjs";
import { findingsFromSarif } from "../security/lib/findings.mjs";
import {
  contractProblems,
  foundationProblems,
  registrationProblems,
  replyProblems,
  routesOf,
  toOpenApiPath,
} from "../security/lib/framework.mjs";
import { compareAlerts } from "../security/lib/code-scanning.mjs";
import { ledgersApplied } from "../security/lib/ledger-record.mjs";
import {
  PERFORMANCE_RULE_CLASSES,
  PROFILES,
  RULE_CLASSES,
  summarize,
  thresholdsFrom,
  toSarif,
} from "../security/lib/maintainability.mjs";
import { checkScanRuns, scanRunProblems } from "../security/lib/scan-run-check.mjs";
import { scrub } from "../../scripts/monitoring/lib/scrub.mjs";

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function tmp(files) {
  const dir = mkdtempSync(join(tmpdir(), "round2-test-"));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

const goodRun = {
  scan: "trivy-image-backend",
  check_kind: "container",
  status: "ok",
  tool: { name: "trivy", version: "0.75.0" },
  command: "trivy image",
  output_location: "security-results/x",
  config_ref: "security/x.yaml",
  rules_ref: null,
  exclusions: ["除外なし（対象の全体を検査した）"],
  thresholds: "high 以上は失敗",
  coverage: { languages: [], paths: [], urls: [], images: ["todo-app-backend:ci"] },
  target: { commit_sha: "a".repeat(40), image_digest: `sha256:${"b".repeat(64)}` },
};

describe("scan-run の完全性", () => {
  it("必要な項目が揃っていれば問題なし", () => {
    assert.deepEqual(scanRunProblems(goodRun), []);
  });

  it("ツール・版・設定 / 規則・除外・閾値・command・出力先・coverage・commit・イメージ digest の欠落を検出する", () => {
    const bad = {
      ...goodRun,
      tool: { name: "trivy", version: null },
      command: null,
      output_location: "",
      config_ref: null,
      exclusions: undefined,
      thresholds: null,
      coverage: { languages: [], paths: [], urls: [], images: [] },
      target: { commit_sha: null, image_digest: null },
    };
    const text = scanRunProblems(bad).join("\n");
    for (const k of [
      "tool.version",
      "command",
      "output_location",
      "config_ref と rules_ref",
      "exclusions",
      "thresholds",
      "coverage",
      "target.commit_sha",
      "target.image_digest",
    ])
      assert.ok(text.includes(k), k);
  });

  it("イメージ検査以外は image_digest を求めず、スキップは理由があれば許す", () => {
    const sca = {
      ...goodRun,
      check_kind: "sca",
      target: { commit_sha: "a" },
      rules_ref: "r",
      config_ref: null,
    };
    assert.deepEqual(scanRunProblems({ ...sca, coverage: { paths: ["package-lock.json"] } }), []);
    assert.equal(scanRunProblems({ scan: "zap", check_kind: "dast", status: "skipped" }).length, 1);
    assert.deepEqual(
      scanRunProblems({ scan: "zap", check_kind: "dast", status: "skipped", skipped_reason: "対象が無い" }),
      [],
    );
  });

  it("check_kind が語彙（qc の ScanCategory）に無ければ検出する", () => {
    assert.match(checkScanRuns([{ ...goodRun, check_kind: "weird" }]).join(), /語彙/);
    for (const k of ["iac", "framework", "performance", "maintainability", "other"])
      assert.ok(!checkScanRuns([{ ...goodRun, check_kind: k }]).some((p) => /語彙/.test(p)), k);
  });
});

describe("IaC の分類", () => {
  const sarif = (tags) => ({
    runs: [
      {
        tool: { driver: { name: "Trivy", rules: [{ id: "DS-0002", properties: { tags } }] } },
        results: [
          {
            ruleId: "DS-0002",
            level: "error",
            message: { text: "m" },
            locations: [{ physicalLocation: { artifactLocation: { uri: "perf/screen/Dockerfile" } } }],
          },
        ],
      },
    ],
  });

  it("trivy の misconfiguration（Dockerfile・compose・workflow の構成誤り）は iac、脆弱性は sca", () => {
    const [iac] = findingsFromSarif(sarif(["misconfiguration"]), { scan: "trivy-iac", check_kind: "iac" });
    assert.equal(iac.category, "iac");
    const [sca] = findingsFromSarif(sarif(["vulnerability"]), { scan: "trivy-fs", check_kind: "sca" });
    assert.equal(sca.category, "sca");
  });
});

describe("台帳を適用した時点の記録", () => {
  it("台帳ごとに sha256・件数・存在を残し、commit と時刻を持つ", () => {
    const root = tmp({
      "security/triage.yaml": "version: 1\nentries:\n  - match:\n      tool: x\n    status: na\n",
      "security/accepted-risks.yaml": "version: 1\nentries:\n",
    });
    const r = ledgersApplied(root, { commit: "c".repeat(40), appliedAt: "2026-10-12T00:00:00.000Z" });
    assert.equal(r.ledger_commit, "c".repeat(40));
    assert.equal(r.ledgers.triage.entries, 1);
    assert.match(r.ledgers.triage.sha256, /^[0-9a-f]{64}$/);
    assert.equal(r.ledgers.accepted_risks.entries, 0);
    assert.equal(r.ledgers.finding_ids.exists, false);
  });

  it("SOURCE.json に写す triage 記録は、triaged であることと適用した台帳を持つ", () => {
    const { triage } = triageSource({
      generated_at: "t",
      target: { commit_sha: "s" },
      gate: { result: "pass" },
      summary: { by_status: { fp: 1 } },
      ledgers_applied: { ledger_commit: "s" },
    });
    assert.match(triage.kind, /triaged/);
    assert.equal(triage.target_commit, "s");
    assert.equal(triage.ledgers_applied.ledger_commit, "s");
    assert.equal(triageSource({}).triage.gate, null);
  });
});

describe("Fastify の規約", () => {
  const routesSrc = `
export function registerTaskRoutes(app) {
  app.get("/api/v1/tasks", async () => ({ tasks: [] }));
  app.post("/api/v1/tasks", async (request, reply) => {
    return reply.code(201).send({});
  });
  app.delete("/api/v1/tasks/:id", async (request, reply) => {
    return reply.code(204).send();
  });
}`;
  const openapi = {
    paths: {
      "/api/v1/tasks": { get: {}, post: {} },
      "/api/v1/tasks/{id}": { delete: {} },
    },
  };

  it("ルートの抽出と、OpenAPI のパスへの変換", () => {
    const routes = routesOf(routesSrc);
    assert.deepEqual(
      routes.map((r) => `${r.method} ${r.path}`),
      ["get /api/v1/tasks", "post /api/v1/tasks", "delete /api/v1/tasks/:id"],
    );
    assert.equal(toOpenApiPath("/a/:id/b/:name"), "/a/{id}/b/{name}");
  });

  it("FW-001: ルートと openapi.yaml の過不足を検出する", () => {
    const routes = routesOf(routesSrc);
    assert.deepEqual(contractProblems(routes, openapi), []);
    const extra = contractProblems(routes, { paths: { "/api/v1/tasks": { get: {} } } }).join("\n");
    assert.match(extra, /post \/api\/v1\/tasks: ルートはあるが openapi\.yaml に無い/);
    const missing = contractProblems(routes, {
      paths: { ...openapi.paths, "/api/v1/health": { get: {} } },
    }).join("\n");
    assert.match(missing, /get \/api\/v1\/health: openapi\.yaml にあるがルートが登録されていない/);
  });

  it("FW-002: reply.send() を return していない・reply と別の値を返す経路の混在を検出する", () => {
    const ok = routesOf(routesSrc).flatMap(replyProblems);
    assert.deepEqual(ok, []);
    const bad = routesOf(`
app.post("/x", async (request, reply) => {
  reply.code(201).send({});
});
app.get("/y", async (request, reply) => {
  if (request.query.a) return reply.send({});
  return { a: 1 };
});`).flatMap(replyProblems);
    assert.ok(bad.some((p) => /return していない/.test(p)));
    assert.ok(bad.some((p) => /混在/.test(p)));
  });

  it("FW-003: エラーハンドラ・未定義ルート・bodyLimit・ロガーが無ければ検出する", () => {
    const full = `Fastify({ logger: { level: "info" }, bodyLimit: 1 }); app.setErrorHandler(f); app.setNotFoundHandler(g);`;
    assert.deepEqual(foundationProblems(full), []);
    assert.equal(foundationProblems("const app = Fastify();").length, 4);
  });

  it("FW-004: register 関数が app.js で import され、1 回ずつ呼ばれているか", () => {
    const sources = { "backend/src/routes/tasks.js": routesSrc };
    const app = `import { registerTaskRoutes } from "./routes/tasks.js";\nregisterTaskRoutes(app);`;
    assert.deepEqual(registrationProblems(sources, app), []);
    assert.match(registrationProblems(sources, "// 何もしない").join(), /import されていない/);
    assert.match(registrationProblems(sources, `${app}\nregisterTaskRoutes(app);`).join(), /2 回/);
  });
});

describe("実行層（tiers）", () => {
  const ci = "on:\n  pull_request:\n  push:\n    branches: [main]\n  workflow_dispatch:\n";
  const nightly = 'on:\n  schedule:\n    - cron: "0 18 * * *"\n    - cron: "0 20 * * 0"\n';
  const release = 'on:\n  push:\n    tags: ["v*.*.*"]\n';

  it("ワークフローのトリガーから層を導く（pr・main・daily・weekly・release）", () => {
    assert.deepEqual(workflowTiers({ "ci.yml": ci, "nightly.yml": nightly, "release.yml": release }), [
      "pr",
      "main",
      "daily",
      "weekly",
      "release",
    ]);
    assert.deepEqual(workflowTiers({ "ci.yml": ci }), ["pr", "main"]);
    assert.deepEqual(workflowTiers({}), []);
  });

  it("手動ケースは manual、pr は変更影響の選択の対象のときだけ、全件の層は全自動化ケース", () => {
    const all = ["pr", "main", "daily", "weekly", "release"];
    assert.deepEqual(tiersOf({ automated: false, selectable: true }, all), ["manual"]);
    assert.deepEqual(tiersOf({ automated: true, selectable: true }, all), all);
    assert.deepEqual(tiersOf({ automated: true, selectable: false }, all), [
      "main",
      "daily",
      "weekly",
      "release",
    ]);
  });
});

describe("所要時間", () => {
  it("elapsedSec は開始・終了が揃うときだけ秒に丸める", () => {
    assert.equal(elapsedSec("2026-10-12T00:00:00Z", "2026-10-12T00:03:20.600Z"), 201);
    assert.equal(elapsedSec(null, "2026-10-12T00:00:00Z"), null);
    assert.equal(elapsedSec("x", "y"), null);
  });

  it("run 全体の所要（run_duration_sec）は run の開始から。duration_sec は記録を作ったジョブ自身", () => {
    const info = runInfo(
      { RUN_STARTED_AT: "2026-10-12T00:00:00Z", CI_STARTED_AT: "2026-10-12T00:03:00Z" },
      "2026-10-12T00:03:02Z",
    );
    assert.equal(info.run_duration_sec, 182);
    assert.equal(info.duration_sec, 2);
    assert.equal(runInfo({}, "2026-10-12T00:00:00Z").run_duration_sec, null);
  });

  const jobs = [
    {
      name: "unit",
      conclusion: "success",
      started_at: "2026-10-12T00:00:10Z",
      completed_at: "2026-10-12T00:00:40Z",
    },
    {
      name: "api-test / api",
      conclusion: "success",
      started_at: "2026-10-12T00:00:10Z",
      completed_at: "2026-10-12T00:01:10Z",
    },
    {
      name: "api-test / contract",
      conclusion: "success",
      started_at: "2026-10-12T00:00:10Z",
      completed_at: "2026-10-12T00:00:50Z",
    },
    {
      name: "e2e (chromium)",
      conclusion: "success",
      started_at: "2026-10-12T00:00:10Z",
      completed_at: "2026-10-12T00:02:10Z",
    },
    {
      name: "e2e (firefox)",
      conclusion: "success",
      started_at: "2026-10-12T00:00:10Z",
      completed_at: "2026-10-12T00:02:40Z",
    },
    { name: "ci-result", conclusion: null, started_at: "2026-10-12T00:03:00Z", completed_at: null },
  ];

  it("層ごとの所要は、その層を流したジョブの最長（再利用ワークフローの接頭辞付きの名前も扱う）。未完了のジョブは数えない", () => {
    const t = layerTimings(jobTimings(jobs));
    assert.equal(t.unit.duration_sec, 30);
    assert.equal(t.api.duration_sec, 60);
    assert.equal(t.contract.duration_sec, 40);
    assert.equal(t.e2e.duration_sec, 150);
    assert.equal(t.e2e.job_time_sum_sec, 270);
    assert.deepEqual(t.e2e.jobs, ["e2e (chromium)", "e2e (firefox)"]);
    assert.equal(jobTimings(jobs).length, 5);
  });

  it("ci-summary の層に、実測の所要・JUnit のテスト時間・出どころを載せる。ジョブ一覧が無ければ JUnit のまま", () => {
    const counts = { total: 1, passed: 1, failed: 0, skipped: 0, retried_success: 0, duration_sec: 12.5 };
    const summaries = [{ job: "j", layers: { unit: counts }, test_cases: {} }];
    const withJobs = mergeSummaries({ env: {}, nowIso: "2026-10-12T00:03:00Z", summaries, jobs });
    assert.equal(withJobs.layers.unit.duration_sec, 30);
    assert.equal(withJobs.layers.unit.test_time_sec, 12.5);
    assert.equal(withJobs.layers.unit.duration_source, "job");
    const without = mergeSummaries({ env: {}, nowIso: "2026-10-12T00:03:00Z", summaries });
    assert.equal(without.layers.unit.duration_sec, 12.5);
    assert.equal(without.layers.unit.duration_source, "junit");
  });

  it("健全性の所要も同じ定義（run の開始〜更新の wall-clock）", () => {
    const run = {
      conclusion: "success",
      run_started_at: "2026-10-12T00:00:00Z",
      updated_at: "2026-10-12T00:04:00Z",
    };
    assert.equal(summarizeRuns("ci.yml", [run]).duration_sec.median, 240);
    assert.equal(
      evaluateHealth(summarizeRuns("ci.yml", [run]), {
        min_success_rate: 0.9,
        max_consecutive_failures: 2,
        max_p95_sec: 600,
      }).length,
      0,
    );
  });
});

describe("evidence の run 取り込みの対応づけ", () => {
  it("api-test.yml 以降の artifact（junit-coverage-api・junit-coverage-unit）と、従来の unit-api の両方を受ける", () => {
    const plan = planRunFiles([
      "junit-coverage-api/all.xml",
      "junit-coverage-api/coverage-summary.json",
      "junit-coverage-api/observations/TC-001.json",
      "junit-coverage-unit/junit.xml",
      "junit-coverage-unit/coverage-summary.json",
      "contract-report/backend/test-results/contract.xml",
    ]).map((p) => p.to);
    assert.deepEqual(plan.sort(), [
      "coverage-backend.json",
      "coverage-frontend.json",
      "junit/backend-junit.xml",
      "junit/contract-junit.xml",
      "junit/frontend-junit.xml",
      "observations/backend/TC-001.json",
    ]);
    const old = planRunFiles(["junit-coverage-unit-api/backend/test-results/all.xml"]).map((p) => p.to);
    assert.deepEqual(old, ["junit/backend-junit.xml"]);
  });
});

describe("結果ファイルに書く値の検証・正規化", () => {
  it("数値は有限の数だけ、文字列は印字文字と 200 字まで、キーは許可した形だけ", () => {
    const out = scrub({
      n: 1,
      bad: Number.NaN,
      s: `a | b != c\u0000\n日本${"x".repeat(300)}`,
      "bad key": 1,
      list: [1, { ok: true }, undefined],
      nested: { v: null },
    });
    assert.equal(out.n, 1);
    assert.equal(out.bad, null);
    assert.equal(out.s.length, 200);
    assert.ok(out.s.startsWith("a | b != c??日本"));
    assert.equal("bad key" in out, false);
    assert.deepEqual(out.list, [1, { ok: true }, null]);
    assert.equal(out.nested.v, null);
  });
});

describe("性能ルールのプロファイル", () => {
  it("保守性と別の分類（loop・concurrency・allocation）で、別の kind として SARIF を作る", () => {
    assert.equal(PROFILES.performance.kind, "performance");
    assert.deepEqual(
      new Set(Object.values(PERFORMANCE_RULE_CLASSES)),
      new Set(["loop", "concurrency", "allocation"]),
    );
    assert.ok(!Object.keys(PERFORMANCE_RULE_CLASSES).some((id) => id in RULE_CLASSES));
    const results = [
      {
        filePath: "/repo/a.js",
        messages: [
          { ruleId: "no-await-in-loop", severity: 2, message: "m", line: 4 },
          { ruleId: "complexity", severity: 2, message: "c", line: 1 },
        ],
      },
    ];
    const sarif = toSarif(results, {
      version: "1",
      thresholds: {},
      root: "/repo",
      profile: PROFILES.performance,
    });
    assert.equal(sarif.runs[0].results.length, 1);
    assert.equal(sarif.runs[0].results[0].properties.rule_class, "loop");
    assert.equal(sarif.runs[0].properties.check_kind, "performance");
    assert.deepEqual(summarize(results, PERFORMANCE_RULE_CLASSES).violations, {
      allocation: 0,
      concurrency: 0,
      loop: 1,
    });
    assert.equal(
      thresholdsFrom({ rules: { "no-await-in-loop": [2] } }, PERFORMANCE_RULE_CLASSES)["no-await-in-loop"]
        .class,
      "loop",
    );
  });
});

describe("Code Scanning と台帳（このコミットで修正済みのアラート）", () => {
  const alert = {
    number: 14,
    state: "dismissed",
    dismissed_comment: "AR-003",
    tool: { name: "CodeQL" },
    rule: { id: "js/http-to-file-access" },
    most_recent_instance: { location: { path: "perf/screen/measure.mjs", start_line: 170 } },
  };

  it("台帳に無い dismissed でも、このコミットの結果に出ていなければ（修正済み）警告にとどめる", () => {
    const fixed = compareAlerts([alert], [], "2026-10-12", []);
    assert.deepEqual(fixed.problems, []);
    assert.match(fixed.warnings.join(), /このコミットでは検出されない/);
  });

  it("このコミットの結果にまだ出ている・結果を渡さないときは、従来どおり問題にする", () => {
    const present = [{ ruleId: "js/http-to-file-access", uri: "perf/screen/measure.mjs" }];
    assert.equal(compareAlerts([alert], [], "2026-10-12", present).problems.length, 1);
    assert.equal(compareAlerts([alert], [], "2026-10-12").problems.length, 1);
  });
});
