// scripts/security/lib の単体テスト。実行: node --test "scripts/test/*.test.mjs"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "yaml";
import { checkCompose, composeToSarif } from "../security/lib/compose.mjs";
import { findingsFromNpmAudit, findingsFromSarif } from "../security/lib/findings.mjs";
import { judge } from "../security/lib/gate.mjs";
import { acceptanceWithinLimit, matches, validateAccepted, validateTriage } from "../security/lib/ledger.mjs";
import { evaluate, evaluateExpression } from "../security/lib/licenses.mjs";
import { annotateSarif } from "../security/lib/scan-run.mjs";
import { applyLedgers, dedupe, gate, trend } from "../security/lib/triage.mjs";
import { checkWorkflow } from "../security/lib/workflows.mjs";
import { parseRules, validateRules, zapToSarif } from "../security/lib/zap.mjs";

const meta = { scan: "trivy-fs", check_kind: "sca", tool: "trivy" };
const sarif = (results, rules = [], name = "Trivy") => ({
  version: "2.1.0",
  runs: [{ tool: { driver: { name, rules } }, results }],
});
const res = (ruleId, extra = {}) => ({
  ruleId,
  level: "warning",
  message: { text: `${ruleId} の説明` },
  locations: [
    { physicalLocation: { artifactLocation: { uri: "package-lock.json" }, region: { startLine: 3 } } },
  ],
  ...extra,
});

describe("findings（SARIF / npm audit の正規化）", () => {
  it("security-severity（CVSS）を優先し、無ければ level で重要度を決める", () => {
    const rules = [
      { id: "CVE-2026-0001", properties: { "security-severity": "9.8", tags: ["vulnerability"] } },
    ];
    const f = findingsFromSarif(sarif([res("CVE-2026-0001"), res("X-2", { level: "error" })], rules), meta);
    assert.deepEqual(
      f.map((x) => x.severity),
      ["critical", "high"],
    );
    assert.equal(f[0].category, "sca");
    assert.equal(f[0].tool, "trivy");
    assert.deepEqual(f[0].advisories, ["CVE-2026-0001"]);
  });

  it("hadolint の error は medium に下げ、指紋は行番号が変わっても同じ", () => {
    const a = findingsFromSarif(sarif([res("DL3025", { level: "error" })], [], "Hadolint"), meta);
    assert.equal(a[0].severity, "medium");
    const moved = res("DL3025", { level: "error" });
    moved.locations[0].physicalLocation.region.startLine = 99;
    const b = findingsFromSarif(sarif([moved], [], "Hadolint"), meta);
    assert.equal(a[0].fingerprint, b[0].fingerprint);
  });

  it("npm audit は勧告ごとに 1 件、GHSA を別名として持つ", () => {
    const doc = {
      vulnerabilities: {
        foo: {
          via: [
            {
              source: 1,
              title: "ReDoS",
              severity: "high",
              url: "https://github.com/advisories/GHSA-abcd-efgh-ijkl",
              range: "<1.2.0",
            },
            "bar",
          ],
          fixAvailable: { version: "1.2.0" },
        },
      },
    };
    const f = findingsFromNpmAudit(doc, { scan: "npm-audit-all" });
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, "high");
    assert.deepEqual(f[0].advisories, ["GHSA-ABCD-EFGH-IJKL"]);
    assert.equal(f[0].fixed_version, "1.2.0");
  });
});

const finding = (o) => ({
  fingerprint: "fp",
  tool: "trivy",
  scan: "trivy-fs",
  category: "sca",
  rule_id: "CVE-2026-0001",
  title: "t",
  severity: "high",
  location: "package-lock.json",
  component: "foo",
  advisories: ["CVE-2026-0001"],
  ...o,
});

describe("triage（台帳の適用・重複排除・差分・ゲート）", () => {
  const ledgers = (triage = [], accepted = []) => ({ triage, accepted, today: "2026-10-11" });

  it("何も書かれていない検出は untriaged のまま、critical/high ならゲートで失敗する（機械は作り話をしない）", () => {
    const [f] = applyLedgers([finding({})], ledgers());
    assert.equal(f.status, "untriaged");
    assert.equal(f.reachability, null);
    assert.equal(gate([f]).result, "fail");
  });

  it("台帳の記載（文脈・是正案）をそのまま取り込み、fp ならゲートを通る", () => {
    const entry = {
      match: { tool: "trivy", rule_id: "CVE-2026-0001" },
      status: "fp",
      reason: "使っていない経路",
      reachability: "到達不能",
      owner: "セキュリティ担当",
    };
    const [f] = applyLedgers([finding({})], ledgers([entry]));
    assert.equal(f.status, "fp");
    assert.equal(f.reachability, "到達不能");
    assert.equal(gate([f]).result, "pass");
  });

  it("受容は high で 30 日まで・期限内のみ。critical は受容できない", () => {
    const acc = {
      id: "AR-1",
      match: { rule_id: "CVE-2026-0001" },
      reason: "r",
      owner: "o",
      accepted_at: "2026-10-01",
      expires_at: "2026-10-31",
      reverify_condition: "c",
    };
    assert.equal(applyLedgers([finding({})], ledgers([], [acc]))[0].status, "accepted");
    assert.equal(
      applyLedgers([finding({ severity: "critical" })], ledgers([], [acc]))[0].status,
      "untriaged",
    );
    assert.equal(
      applyLedgers([finding({})], ledgers([], [{ ...acc, expires_at: "2026-12-31" }]))[0].status,
      "untriaged",
    );
    const expired = applyLedgers([finding({})], {
      ...ledgers([], [{ ...acc, expires_at: "2026-10-05" }]),
    })[0];
    assert.match(expired.acceptance_problem, /期限切れ/);
  });

  it("同じ勧告・同じ部品を複数ツールが出したら 1 つにまとめる", () => {
    const a = finding({ tool: "osv-scanner", fingerprint: "a" });
    const b = finding({ tool: "npm-audit", fingerprint: "b" });
    const c = finding({ tool: "trivy", fingerprint: "c", component: "other" });
    const out = dedupe([b, a, c]);
    assert.equal(out.find((f) => f.fingerprint === "b").duplicate_of, "a");
    assert.equal(out.find((f) => f.fingerprint === "c").duplicate_of, undefined);
  });

  it("前回との差分: new / persistent / fixed", () => {
    const prev = { findings: [{ fingerprint: "keep" }, { fingerprint: "gone" }] };
    const t = trend([{ fingerprint: "keep" }, { fingerprint: "added" }], prev);
    assert.deepEqual([t.new, t.persistent, t.fixed], [["added"], ["keep"], ["gone"]]);
  });

  it("medium の未解決は失敗にはせず Issue 化の対象として挙げる", () => {
    const [f] = applyLedgers([finding({ severity: "medium" })], ledgers());
    const g = gate([f]);
    assert.equal(g.result, "pass");
    assert.equal(g.medium_needs_issue_or_acceptance.length, 1);
  });
});

describe("ledger（台帳の検証と突合）", () => {
  it("すべての状態に、理由・修正方法・代替案・owner・期限・再検査条件が必須", () => {
    const full = {
      reason: "r",
      recommendation: "修正方法（または修正しない理由と代替統制）",
      alternative: "代替案",
      owner: "o",
      due: "2027-01-09",
      reverify_condition: "c",
    };
    for (const status of ["tp", "fp", "na", "dup"]) {
      assert.equal(validateTriage([{ match: { tool: "x" }, status, reason: "r" }]).length, 1, status);
      assert.deepEqual(validateTriage([{ match: { tool: "x" }, status, ...full }]), [], status);
    }
    const missing = validateTriage([{ match: { tool: "x" }, status: "fp", reason: "r" }])[0];
    for (const k of ["recommendation", "alternative", "owner", "due", "reverify_condition"])
      assert.ok(missing.includes(k), k);
    assert.equal(validateTriage([{ match: { tool: "x" }, status: "accepted", ...full }]).length, 1);
  });

  it("受容は理由・owner・期限が必須で、期限切れは問題", () => {
    assert.equal(validateAccepted([{ id: "A", match: { tool: "x" } }], "2026-10-11").length, 1);
    const ok = {
      id: "A",
      match: { tool: "x" },
      reason: "r",
      recommendation: "修正方法",
      alternative: "代替案",
      owner: "o",
      accepted_at: "2026-10-01",
      expires_at: "2026-10-20",
      reverify_condition: "c",
    };
    // 修正方法・代替案が無い受容は台帳として不完全
    assert.equal(
      validateAccepted([{ ...ok, recommendation: "", alternative: undefined }], "2026-10-11").length,
      1,
    );
    assert.deepEqual(validateAccepted([ok], "2026-10-11"), []);
    assert.equal(validateAccepted([ok], "2026-11-01").length, 1);
    assert.ok(acceptanceWithinLimit(ok, "high"));
    assert.ok(!acceptanceWithinLimit(ok, "critical"));
  });

  it("match は指定した項目すべてに一致し、location は glob（行番号は無視）", () => {
    const f = finding({ location: "backend/Dockerfile:30" });
    assert.ok(matches({ match: { location: "backend/*", tool: "trivy" } }, f));
    assert.ok(!matches({ match: { location: "backend/*", tool: "other" } }, f));
    assert.ok(!matches({ match: {} }, f));
  });
});

describe("workflows（GitHub Actions の統制 W1〜W10）", () => {
  const good = parse(`
on: { pull_request: {} }
permissions: { contents: read }
concurrency: { group: g }
jobs:
  a:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
      - run: echo "$X"
`);
  const rules = (doc, policy = {}) =>
    checkWorkflow("t.yml", doc, policy)
      .map((v) => v.rule)
      .sort();

  it("統制どおりのワークフローは違反なし", () => assert.deepEqual(rules(good), []));

  it("permissions なし・SHA 固定なし・timeout なし・continue-on-error・pull_request_target を検出する", () => {
    const bad = parse(`
on: pull_request_target
concurrency: { group: g }
jobs:
  a:
    runs-on: x
    steps:
      - uses: actions/checkout@v4
      - run: echo
        continue-on-error: true
`);
    assert.deepEqual(rules(bad), ["W1", "W2", "W3", "W4", "W6"]);
  });

  it("フォーク PR への secret・OIDC・write 権限は許可リストが無ければ違反", () => {
    const doc = parse(`
on: pull_request
permissions: { contents: read }
concurrency: { group: g }
jobs:
  a:
    runs-on: x
    timeout-minutes: 5
    permissions: { id-token: write, issues: write }
    steps:
      - run: echo
        env: { T: "\${{ secrets.DEPLOY_TOKEN }}" }
`);
    assert.deepEqual(rules(doc), ["W10", "W7", "W8"]);
    const policy = { id_token_write_jobs: ["t.yml#a"], write_permissions: { "t.yml#a": ["issues"] } };
    assert.deepEqual(rules(doc, policy), ["W7"]);
  });

  it("信頼できない値（PR タイトルなど）を run に直接埋め込むと違反", () => {
    const doc = parse(`
on: push
permissions: { contents: read }
concurrency: { group: g }
jobs:
  a:
    runs-on: x
    timeout-minutes: 5
    steps:
      - run: echo "\${{ github.event.pull_request.title }}"
`);
    assert.deepEqual(rules(doc), ["W9"]);
  });
});

describe("licenses / gate / zap / compose / scan-run", () => {
  it("SPDX 式は OR ならどれか、AND ならすべてが許可されていること。例外は期限内のみ", () => {
    const ok = (id) => ["MIT", "ISC"].includes(id);
    assert.ok(evaluateExpression("(MIT OR GPL-3.0)", ok));
    assert.ok(!evaluateExpression("(MIT AND CC-BY-3.0)", ok));
    const policy = {
      allow: ["MIT"],
      deny_patterns: ["GPL-*"],
      exceptions: [{ package: "b@1", reason: "r", expires_at: "2026-12-01" }],
    };
    const entries = {
      "a@1": { licenses: "GPL-3.0" },
      "b@1": { licenses: "CC-BY-3.0" },
      "c@1": { licenses: "MIT" },
    };
    const r = evaluate(entries, policy, "2026-10-11");
    assert.deepEqual(
      r.violations.map((v) => [v.package, v.kind]),
      [["a@1", "禁止"]],
    );
    assert.equal(r.exceptions_used.length, 1);
    assert.equal(evaluate(entries, policy, "2027-01-01").violations.length, 2);
  });

  it("security-result: skipped は成功扱いにしない。そのイベントで動かないと宣言したジョブだけ許す", () => {
    const needs = {
      sast: { result: "success" },
      "dependency-review": { result: "skipped" },
      scorecard: { result: "skipped" },
    };
    assert.equal(judge(needs, "push").pass, true);
    assert.equal(judge(needs, "pull_request").pass, false);
    assert.equal(judge({ sast: { result: "skipped" } }, "push").pass, false);
    assert.equal(judge({ sast: { result: "failure" } }, "push").pass, false);
  });

  it("ZAP: IGNORE は検出から外し、FAIL は high 以上にする。IGNORE に期限が無ければ問題", () => {
    const rules = parseRules(
      "10038\tIGNORE\t理由; owner=QA; expires=2026-12-01\n10021\tFAIL\t\n10054\tWARN\t\n",
    );
    const report = {
      "@version": "2.17.0",
      site: [
        {
          "@name": "http://localhost:8080",
          alerts: [
            {
              pluginid: "10038",
              name: "CSP",
              riskcode: "2",
              riskdesc: "Medium",
              instances: [{ uri: "/", method: "GET" }],
            },
            {
              pluginid: "10021",
              name: "X-Content-Type-Options",
              riskcode: "1",
              riskdesc: "Low",
              instances: [],
            },
            { pluginid: "10054", name: "Cookie", riskcode: "0", riskdesc: "Info", instances: [] },
          ],
        },
      ],
    };
    const { sarif: s, ignored } = zapToSarif(report, rules);
    assert.equal(ignored.length, 1);
    assert.deepEqual(
      s.runs[0].results.map((r) => [r.ruleId, r.properties["security-severity"]]),
      [
        ["10021", "7.5"],
        ["10054", "0"],
      ],
    );
    assert.equal(validateRules(rules, "2026-10-11").length, 0);
    assert.equal(validateRules(rules, "2027-01-01").length, 1);
    assert.equal(validateRules(parseRules("1\tIGNORE\t理由だけ"), "2026-10-11").length, 2);
  });

  it("compose-check: privileged・docker.sock・内部サービスの公開を検出し SARIF にする", () => {
    const config = {
      services: {
        backend: {
          image: "x@sha256:1",
          privileged: true,
          ports: [{ published: "3000", target: 3000 }],
          volumes: [{ source: "/var/run/docker.sock" }],
        },
        frontend: {
          build: {},
          cap_drop: ["ALL"],
          security_opt: ["no-new-privileges:true"],
          ports: [{ published: "8080", target: 80, host_ip: "127.0.0.1" }],
        },
      },
    };
    const hits = checkCompose(config);
    assert.deepEqual([...new Set(hits.map((h) => h.rule))].sort(), [
      "COMPOSE-001",
      "COMPOSE-003",
      "COMPOSE-005",
      "COMPOSE-006",
      "COMPOSE-007",
    ]);
    assert.ok(hits.every((h) => h.service === "backend"));
    assert.equal(composeToSarif(hits, "docker-compose.yml", "n").runs[0].results.length, hits.length);
  });

  it("scan-run: SARIF に出自（repo・commit）と実行情報を追記し、既存値は壊さない", () => {
    const doc = {
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "x" } }, results: [], invocations: [] }],
    };
    const run = {
      scan: "s",
      started_at: "t0",
      finished_at: "t1",
      command: "cmd",
      config_ref: "c",
      exit_ok: true,
      target: { repository: "https://github.com/o/r", commit_sha: "abc", branch: "main", image_digest: null },
    };
    const out = annotateSarif(doc, run);
    assert.equal(out.runs[0].versionControlProvenance[0].revisionId, "abc");
    assert.equal(out.runs[0].invocations[0].commandLine, "cmd");
    const again = annotateSarif(out, {
      ...run,
      command: "other",
      target: { ...run.target, commit_sha: "zzz" },
    });
    assert.equal(again.runs[0].versionControlProvenance[0].revisionId, "abc");
    assert.equal(again.runs[0].invocations[0].commandLine, "cmd");
  });
});
