// scripts/ci/lib の単体テスト（CI 基盤そのものの回帰防止）。実行: node --test scripts/test/
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseArgs } from "../ci/lib/args.mjs";
import { parseCsv, parseCsvObjects, toCsv } from "../ci/lib/csv.mjs";
import {
  checkIdReferences,
  checkManifest,
  checkMarkdownLinks,
  checkTestCoverage,
} from "../ci/lib/docs-checks.mjs";
import { countBy, layerOf, parseJunit, tcIdsOf } from "../ci/lib/junit.mjs";
import { globToRegExp } from "../ci/lib/repo-fs.mjs";
import { buildSummary, mergeSummaries } from "../ci/lib/summary.mjs";
import { parseYaml } from "../ci/lib/yaml-lite.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "ci-lib-"));
const put = (root, rel, text) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};

describe("yaml-lite", () => {
  it("マップ・リスト・リスト内マップ・コメント・フロー形式を読める", () => {
    const doc = parseYaml(`
# コメント
version: 1
items:
  - id: a   # 末尾コメント
    globs: ["x/**", "y/*.js"]
    note: "引用: あり"
  - id: b
    globs: []
text: |
  1 行目
  2 行目
flag: true
empty:
`);
    assert.equal(doc.version, 1);
    assert.deepEqual(doc.items[0], { id: "a", globs: ["x/**", "y/*.js"], note: "引用: あり" });
    assert.deepEqual(doc.items[1].globs, []);
    assert.equal(doc.text, "1 行目\n2 行目");
    assert.equal(doc.flag, true);
    assert.equal(doc.empty, null);
  });

  it("日付は文字列のまま返し、アンカーは明示エラー", () => {
    assert.equal(parseYaml("d: 2026-10-11").d, "2026-10-11");
    assert.throws(() => parseYaml("a: &x 1"), /未対応/);
  });

  it("ルート直下のリストと、キーと同じ字下げのリストを読める", () => {
    assert.deepEqual(parseYaml("- 1\n- two\n"), [1, "two"]);
    assert.deepEqual(parseYaml("k:\n- a\n- b\nz: 1\n"), { k: ["a", "b"], z: 1 });
  });
});

describe("csv", () => {
  it("引用符・改行・エスケープを往復できる", () => {
    const rows = [{ a: "x,y", b: 'He said "hi"', c: "l1\nl2" }];
    const text = toCsv(["a", "b", "c"], rows);
    assert.deepEqual(parseCsvObjects(text).rows, rows);
    assert.equal(parseCsv("a,b\r\n1,2\r\n").length, 2);
  });
});

describe("args / glob", () => {
  it("繰り返しキーは配列、フラグは真偽値", () => {
    const a = parseArgs(["--layer", "u=1", "--layer", "e=2", "--strict", "pos"], { flags: ["strict"] });
    assert.deepEqual(a.layer, ["u=1", "e=2"]);
    assert.equal(a.strict, true);
    assert.deepEqual(a._, ["pos"]);
  });

  it("glob の ** と * を区別する", () => {
    assert.ok(globToRegExp("backend/src/**").test("backend/src/a/b.js"));
    assert.ok(globToRegExp("**/*.md").test("README.md"));
    assert.ok(!globToRegExp("backend/*.js").test("backend/src/a.js"));
  });
});

const XML = `<testsuites>
<testsuite name="s"><testcase name="[TC-001] ok" classname="a" time="0.5" file="/r/backend/test/unit/a.test.js"/>
<testcase name="[TC-002] ng &amp; more" classname="a" time="1"><failure message="x"/></testcase>
<testcase name="[TC-003][TC-004] skip" classname="a" time="0"><skipped/></testcase>
<testcase name="[TC-002] ng &amp; more" classname="a" time="1"/></testsuite></testsuites>`;

describe("junit / summary", () => {
  it("JUnit を読み、TC-ID と retry 後成功を数える", () => {
    const cases = parseJunit(XML, "backend/test-results/junit.xml");
    assert.equal(cases.length, 4);
    assert.deepEqual(tcIdsOf(cases[2].name), ["TC-003", "TC-004"]);
    const c = countBy(cases);
    assert.deepEqual([c.total, c.passed, c.failed, c.skipped, c.retried_success], [4, 2, 1, 1, 1]);
    assert.equal(layerOf(cases[0], "e2e"), "unit");
  });

  it("ci-summary は対象 SHA（TARGET_SHA）を優先し、層ごとに集計する", () => {
    const cases = parseJunit(XML, "x.xml");
    const env = { GITHUB_SHA: "merge", TARGET_SHA: "head", GITHUB_RUN_ID: "1" };
    const s = buildSummary({
      env,
      nowIso: "2026-10-11T00:00:00Z",
      layerSpecs: [{ layer: "api", cases, files: ["x.xml"] }],
    });
    assert.equal(s.commit_sha, "head");
    assert.equal(s.layers.api.total, 3);
    assert.equal(s.layers.unit.total, 1);
    assert.equal(s.test_cases["TC-002"].flaky, true);
    const merged = mergeSummaries({
      env,
      nowIso: "2026-10-11T00:01:00Z",
      summaries: [s, s],
      jobResults: { a: "success", b: "skipped" },
    });
    assert.equal(merged.layers.api.total, 6);
    assert.equal(merged.gate, "fail");
  });
});

describe("docs-check", () => {
  it("未解決の ID 参照を検出する", () => {
    const root = tmp();
    put(root, "docs/data/cases.csv", "test_case_id,requirement_ids\nTC-001,REQ-001;REQ-009\n");
    put(root, "docs/data/requirements.csv", "id,text\nREQ-001,x\n");
    const r = checkIdReferences(root);
    assert.equal(r.status, "fail");
    assert.match(r.messages[0], /REQ-009/);
  });

  it("manifest の sha256 不一致を検出し、無ければスキップ", () => {
    const root = tmp();
    assert.equal(checkManifest(root).status, "skipped");
    put(root, "docs/evidence/a.txt", "hello");
    put(root, "docs/evidence/manifest.json", JSON.stringify({ files: [{ path: "a.txt", sha256: "00" }] }));
    assert.equal(checkManifest(root).status, "fail");
    const good = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    put(root, "docs/evidence/manifest.json", JSON.stringify({ files: { "a.txt": good } }));
    assert.equal(checkManifest(root).status, "pass");
  });

  it("TC-ID の未対応・未知 ID を検出し、known-gaps は期限内のみ許容", () => {
    const root = tmp();
    put(
      root,
      "docs/data/cases.csv",
      "test_case_id,automation_layer\nTC-001,api\nTC-002,e2e\nTC-003,manual\n",
    );
    put(root, "backend/package.json", "{}");
    put(root, "backend/test/a.test.js", 'it("[TC-001] a"); it("[TC-099] b");');
    const bad = checkTestCoverage(root, "2026-10-11");
    assert.equal(bad.status, "fail");
    assert.ok(bad.messages.some((m) => m.includes("TC-099")));
    assert.ok(bad.messages.some((m) => m.includes("TC-002")));
    put(
      root,
      "quality/known-gaps.yaml",
      "gaps:\n  - test_case_id: TC-002\n    reason: r\n    owner: QA\n    expires_at: 2026-12-01\n",
    );
    put(root, "backend/test/a.test.js", 'it("[TC-001] a");');
    assert.equal(checkTestCoverage(root, "2026-10-11").status, "pass");
    assert.equal(checkTestCoverage(root, "2026-12-02").status, "fail");
  });

  it("Markdown の壊れた相対リンクだけを検出する", () => {
    const root = tmp();
    put(root, "docs/a.md", "[ok](b.md) [ng](c.md) [web](https://x.example) [anchor](#h) `[code](zzz.md)`");
    put(root, "docs/b.md", "x");
    const r = checkMarkdownLinks(root);
    assert.deepEqual(r.messages, ["リンク切れ: docs/a.md: c.md"]);
  });
});
