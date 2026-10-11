// レビュー指摘（Dependabot の網羅・依存選定の照合・Code Scanning と台帳・回帰台帳の列・change_kind・健全性の閾値）の単体テスト。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageRows, publishedScanLines, renderNotes } from "../ci/lib/release-notes.mjs";
import { evaluateHealth } from "../regression/lib/health.mjs";
import { checkImpactMap, missingChangeKinds } from "../regression/lib/impact-check.mjs";
import { select, validateMap } from "../regression/lib/impact.mjs";
import { buildRows, lastRunOf, stepsHash } from "../regression/lib/suite.mjs";
import { compareAlerts, ledgerMatches } from "../security/lib/code-scanning.mjs";
import {
  dependabotProblems,
  imageRefs,
  manifestDirs,
  parseImage,
  selectionProblems,
} from "../security/lib/manifests.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const PW_DIGEST = `sha256:${"c".repeat(64)}`;

describe("Dependabot の網羅", () => {
  const files = [
    "package.json",
    "backend/package.json",
    "perf/screen/package.json",
    "backend/Dockerfile",
    "perf/screen/Dockerfile",
    "docker-compose.yml",
    "perf/compose.perf.yml",
    ".github/workflows/ci.yml",
    ".github/actions/setup/action.yml",
  ];
  const full = {
    updates: [
      { "package-ecosystem": "npm", directories: ["/", "/backend", "/perf/screen"] },
      { "package-ecosystem": "docker", directories: ["/backend", "/perf/screen"] },
      { "package-ecosystem": "docker-compose", directories: ["/", "/perf"] },
      { "package-ecosystem": "github-actions", directories: ["/", "/.github/actions/setup"] },
    ],
  };

  it("追跡ファイルから種類ごとのディレクトリを列挙する", () => {
    const d = manifestDirs(files);
    assert.deepEqual(d.npm, ["/", "/backend", "/perf/screen"]);
    assert.deepEqual(d.docker, ["/backend", "/perf/screen"]);
    assert.deepEqual(d.compose, ["/", "/perf"]);
    assert.deepEqual(d.actions, ["/.github/actions/setup"]);
  });

  it("すべて覆っていれば問題なし", () => {
    assert.deepEqual(dependabotProblems(full, files), []);
  });

  it("覆われていないマニフェストと、存在しないディレクトリの記載を検出する", () => {
    const lacking = {
      updates: [
        { "package-ecosystem": "npm", directories: ["/", "/backend", "/gone"] },
        { "package-ecosystem": "docker", directories: ["/backend"] },
        { "package-ecosystem": "docker-compose", directories: ["/"] },
        { "package-ecosystem": "github-actions", directories: ["/"] },
      ],
    };
    const p = dependabotProblems(lacking, files).join("\n");
    assert.match(p, /npm の \/perf\/screen が覆われていない/);
    assert.match(p, /docker の \/perf\/screen が覆われていない/);
    assert.match(p, /docker-compose の \/perf が覆われていない/);
    assert.match(p, /github-actions の \/\.github\/actions\/setup が覆われていない/);
    assert.match(p, /npm の \/gone にマニフェストが無い/);
  });
});

describe("イメージ参照の抽出", () => {
  it("FROM の段名参照と scratch を除き、compose の image を拾う", () => {
    const refs = imageRefs(
      `FROM node:24-alpine@${DIGEST} AS build\nFROM build AS test\nFROM scratch\nFROM --platform=linux/amd64 nginx:1@${DIGEST}\n  image: "redis:7@${DIGEST}"\n  image: \${APP_IMAGE}`,
      "x",
    );
    assert.deepEqual(
      refs.map((r) => r.repository),
      ["node", "nginx", "redis"],
    );
  });

  it("registry のポートとタグを取り違えない", () => {
    const i = parseImage(`registry.example:5000/app/web:1.2@${DIGEST}`, "f");
    assert.equal(i.repository, "registry.example:5000/app/web");
    assert.equal(i.tag, "1.2");
    assert.equal(i.digest, DIGEST);
  });
});

describe("依存の選定記録の照合", () => {
  const entries = [
    { name: "express", kind: "library", version: "5.1.0" },
    { name: "playwright-core", kind: "library", version: "1.55.0" },
    { name: "nginx", kind: "base-image", version: `stable-alpine-slim@${DIGEST}` },
    { name: "mcr.microsoft.com/playwright", kind: "base-image", version: `v1.55.0-noble@${PW_DIGEST}` },
  ];
  const packages = {
    "backend/package.json": { dependencies: { express: "5.1.0" } },
    "perf/screen/package.json": { dependencies: { "playwright-core": "1.55.0" } },
  };
  const dockerfiles = {
    "frontend/Dockerfile": `FROM nginx:stable-alpine-slim@${DIGEST}`,
    "perf/screen/Dockerfile": `FROM mcr.microsoft.com/playwright:v1.55.0-noble@${PW_DIGEST}`,
  };

  it("一致していれば問題なし", () => {
    assert.deepEqual(selectionProblems({ entries, packages, dockerfiles }), []);
  });

  it("記録が無い依存・古い版・存在しない記載を検出する", () => {
    const p = selectionProblems({
      entries: [entries[0], entries[2], { name: "gone", kind: "library", version: "1.0.0" }],
      packages: {
        ...packages,
        "backend/package.json": { dependencies: { express: "5.2.0", lighthouse: "12.0.0" } },
      },
      dockerfiles,
    }).join("\n");
    assert.match(p, /express の版が古い/);
    assert.match(p, /lighthouse.*選定記録が無い/);
    assert.match(p, /playwright-core.*選定記録が無い/);
    assert.match(p, /gone はどの package\.json にも無い/);
    assert.match(p, /mcr\.microsoft\.com\/playwright.*選定記録が無い/);
  });

  it("ベースイメージの digest が違えば古い記載として検出する", () => {
    const other = `sha256:${"b".repeat(64)}`;
    const p = selectionProblems({
      entries,
      packages,
      dockerfiles: { ...dockerfiles, "frontend/Dockerfile": `FROM nginx:stable-alpine-slim@${other}` },
    }).join("\n");
    assert.match(p, /nginx の記載が古い/);
  });

  it("digest が無いイメージと、Playwright のイメージと playwright-core の版のずれを検出する", () => {
    const p = selectionProblems({
      entries,
      packages,
      dockerfiles: {
        "frontend/Dockerfile": "FROM nginx:stable-alpine-slim",
        "perf/screen/Dockerfile": `FROM mcr.microsoft.com/playwright:v1.54.0-noble@${PW_DIGEST}`,
      },
    }).join("\n");
    assert.match(p, /digest で固定されていない/);
    assert.match(p, /playwright-core 1\.55\.0 と違う/);
  });
});

describe("Code Scanning と台帳のずれ", () => {
  const alert = (o = {}) => ({
    number: 1,
    state: "dismissed",
    dismissed_comment: "AR-001 期限 2027-01-01",
    tool: { name: "CodeQL" },
    rule: { id: "js/missing-rate-limiting" },
    most_recent_instance: { location: { path: "backend/src/app.js", start_line: 10 } },
    ...o,
  });
  const accepted = [
    {
      id: "AR-001",
      expires_at: "2027-01-01",
      match: { tool: "codeql", rule_id: "js/missing-*", location: "backend/src/**" },
    },
  ];

  it("tool・rule_id・場所が当たるときだけ台帳に一致する", () => {
    assert.equal(ledgerMatches(accepted[0], alert()), true);
    assert.equal(ledgerMatches(accepted[0], alert({ rule: { id: "js/other" } })), false);
    assert.equal(ledgerMatches({ match: { rule_id: "*" } }, alert()), false, "tool の指定が必須");
  });

  it("台帳と一致した dismissed は問題なし", () => {
    const r = compareAlerts([alert()], accepted, "2026-10-12");
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.stats, { alerts: 1, open: 0, dismissed: 1 });
  });

  it("台帳に無い open・台帳に無い dismissed・台帳にあるのに open・コメントに AR-ID なし・期限切れを検出する", () => {
    const other = { rule: { id: "js/xss" }, most_recent_instance: { location: { path: "frontend/a.js" } } };
    const p = compareAlerts(
      [
        alert({ number: 2, state: "open", ...other }),
        alert({ number: 3, ...other }),
        alert({ number: 4, state: "open" }),
        alert({ number: 5, dismissed_comment: "理由だけ" }),
      ],
      accepted,
      "2026-10-12",
    ).problems.join("\n");
    assert.match(p, /#2 .*台帳に無い open/);
    assert.match(p, /#3 .*台帳（accepted-risks\.yaml）に無いのに GitHub 側で dismissed/);
    assert.match(p, /#4 .*受容済みなのに GitHub 側で open/);
    assert.match(p, /#5 .*コメントに AR-001 が無い/);
    const expired = compareAlerts([alert()], accepted, "2027-02-01").problems.join("\n");
    assert.match(expired, /期限切れ/);
  });

  it("対応するアラートが無い台帳の受容は警告にする", () => {
    const r = compareAlerts([], accepted, "2026-10-12");
    assert.deepEqual(r.problems, []);
    assert.equal(r.warnings.length, 1);
  });

  it("CodeQL 以外のアラートは見ない", () => {
    const r = compareAlerts([alert({ tool: { name: "Trivy" }, state: "open" })], accepted, "2026-10-12");
    assert.deepEqual(r.problems, []);
  });
});

describe("回帰スイート台帳の実施列", () => {
  const exec = (o) => ({
    test_case_id: "TC-001",
    run_ref: "gh-run-1",
    environment: "e2e/chromium / chromium 156 / 1280x800",
    status: "pass",
    executed_at: "2026-10-11T10:00:00.000Z",
    ...o,
  });

  it("最新の run の時刻・run・環境・結果を要約する", () => {
    const r = lastRunOf([
      exec({}),
      exec({ run_ref: "gh-run-2", executed_at: "2026-10-12T10:00:00.000Z" }),
      exec({
        run_ref: "gh-run-2",
        environment: "e2e/firefox / firefox 157",
        status: "fail",
        executed_at: "2026-10-12T10:00:05.000Z",
      }),
    ]);
    assert.equal(r.last_run_at, "2026-10-12T10:00:05.000Z");
    assert.equal(r.last_run_ids, "gh-run-2;gh-run-1");
    assert.equal(r.environment, "e2e/chromium;e2e/firefox");
    assert.equal(r.last_result, "fail");
  });

  it("実施が無い（not_run のみ・履歴なし）なら空欄と not_run", () => {
    for (const e of [[], undefined, [exec({ status: "not_run", executed_at: "" })]]) {
      assert.deepEqual(lastRunOf(e), {
        last_run_at: "",
        last_run_ids: "",
        environment: "",
        last_result: "not_run",
      });
    }
  });

  it("steps_hash は手順が変わると変わり、前後の空白では変わらない", () => {
    assert.match(stepsHash("開く"), /^[0-9a-f]{12}$/);
    assert.equal(stepsHash("開く"), stepsHash(" 開く\n"));
    assert.notEqual(stepsHash("開く"), stepsHash("閉じる"));
  });

  it("buildRows が列を埋める", () => {
    const rows = buildRows({
      cases: [
        {
          test_case_id: "TC-001",
          automation_layer: "e2e",
          priority: "high",
          requirement_ids: "",
          perspective_ids: "",
          manual_reason: "",
          action: "開く",
        },
      ],
      journeys: [],
      smokeIds: [],
      quarantinedIds: new Set(),
      defects: new Map(),
      executions: new Map([["TC-001", [exec({})]]]),
    });
    assert.equal(rows[0].last_result, "pass");
    assert.equal(rows[0].steps_hash, stepsHash("開く"));
    assert.equal(rows[0].status, "active", "status は運用上の状態のまま");
  });
});

describe("change_kind", () => {
  const entry = (o) => ({ id: "e", feature: "f", paths: ["a/**"], case_ids: [], ...o });

  it("語彙の外の値は不正、未設定は impact-check が検出する", () => {
    assert.match(validateMap({ entries: [entry({ change_kind: "other" })] }).join(), /不正な change_kind/);
    assert.deepEqual(validateMap({ entries: [entry({ change_kind: "db" })] }), []);
    const map = { entries: [entry({}), entry({ id: "ok", change_kind: "api" })], no_test_impact: [] };
    assert.equal(missingChangeKinds(map).length, 1);
    const res = checkImpactMap({ map, files: ["a/x"], cases: [] });
    assert.ok(res.errors.some((e) => /change_kind/.test(e)));
  });

  it("選択結果に、当たったエントリの change_kinds が載る", () => {
    const map = {
      smoke_case_ids: [],
      entries: [
        entry({ id: "s", paths: ["store/**"], change_kind: "db", case_ids: ["TC-001"] }),
        entry({ id: "o", paths: ["openapi.yaml"], change_kind: "api", case_ids: ["TC-001"] }),
      ],
    };
    const cases = [{ test_case_id: "TC-001", automation_layer: "api", risk_ids: "" }];
    const r = select({ map, files: ["store/a.js", "openapi.yaml"], cases });
    assert.deepEqual(r.change_kinds, ["api", "db"]);
  });
});

describe("健全性の閾値", () => {
  const summary = (workflow) => ({
    workflow,
    runs_observed: 10,
    success_rate: 1,
    consecutive_failures: 0,
    duration_sec: { p95: 900 },
  });
  const limits = { min_success_rate: 0.9, max_consecutive_failures: 2, max_p95_sec: 600 };

  it("既定は 600 秒、workflow ごとの上限があればそれを使う", () => {
    assert.equal(evaluateHealth(summary("ci.yml"), limits).length, 1);
    const withCap = { ...limits, per_workflow_p95_sec: { "nightly.yml": 1800 } };
    assert.equal(evaluateHealth(summary("nightly.yml"), withCap).length, 0);
    assert.equal(evaluateHealth(summary("ci.yml"), withCap).length, 1);
  });
});

describe("公開した digest の検査（リリースノート）", () => {
  const d = (c) => `sha256:${c.repeat(64)}`;
  const published = {
    scans: [
      { scan: "trivy-published-backend", digest: d("a"), status: "ok", findings: 1 },
      { scan: "trivy-published-frontend", digest: d("b"), status: "failed", findings: 0 },
    ],
    gate: { result: "pass" },
  };

  it("検査ごとに、検査した digest・実行結果・SARIF の件数・ゲート結果を表にする", () => {
    const text = publishedScanLines(published).join("\n");
    assert.ok(text.includes(d("a")) && text.includes(d("b")));
    assert.match(text, /trivy-published-backend .*ok.* 1 \|/);
    assert.match(text, /trivy-published-frontend .*failed/);
    assert.match(text, /ゲート \*\*pass\*\*/);
  });

  it("記録が無ければ「記録が無い」と書く（検査した体にしない）", () => {
    assert.match(publishedScanLines(null).join(), /記録が無い/);
  });

  it("リリースノートに節が入り、dry-run では公開前の検査だと明示する", () => {
    const rows = imageRows({ backend: d("a"), frontend: d("b") }, "v1.2.3", "abc1234");
    const base = { version: "v1.2.3", sha: "f".repeat(40), repo: "o/r", runUrl: "u", rows, published };
    const dry = renderNotes({ ...base, publish: false });
    assert.match(dry, /## 公開したイメージの検査/);
    assert.match(dry, /公開前の OCI アーカイブ/);
    assert.ok(!renderNotes({ ...base, publish: true }).includes("公開前の OCI アーカイブ"));
  });
});
