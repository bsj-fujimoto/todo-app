// JUnit の読み取りと、観察値 → 実測の文（actual_result）。小さな合成データで確かめる（固定の時刻・乱数なし）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJunitSuites, tcIdsOf } from "../lib/junit-suites.mjs";
import { actualResultOf, callsText, clipText, describeEntry } from "../lib/observations.mjs";

const PLAYWRIGHT_XML = `<testsuites>
<testsuite name="a.spec.js" timestamp="2026-10-11T08:00:00.000Z" hostname="chromium" tests="3">
<testcase name="[TC-001] 追加できる" classname="a.spec.js" time="0.5">
</testcase>
<testcase name="[TC-002] 失敗する" classname="a.spec.js" time="1.25">
<failure message="expected 1&#10;received 2" type="FAILURE"></failure>
</testcase>
<testcase name="[TC-003] 飛ばす" classname="a.spec.js" time="0">
<skipped/>
</testcase>
</testsuite>
</testsuites>`;

describe("parseJunitSuites", () => {
  it("結果・失敗の 1 行目・所属 suite の hostname と timestamp を読む", () => {
    const cases = parseJunitSuites(PLAYWRIGHT_XML, "junit/e2e-chromium-junit.xml");
    assert.deepEqual(
      cases.map((c) => [c.name, c.status, c.hostname, c.timestamp, c.time]),
      [
        ["[TC-001] 追加できる", "passed", "chromium", "2026-10-11T08:00:00.000Z", 0.5],
        ["[TC-002] 失敗する", "failed", "chromium", "2026-10-11T08:00:00.000Z", 1.25],
        ["[TC-003] 飛ばす", "skipped", "chromium", "2026-10-11T08:00:00.000Z", 0],
      ],
    );
    assert.equal(cases[1].message, "expected 1");
    assert.equal(cases[0].source, "junit/e2e-chromium-junit.xml");
  });

  it("node:test が出すファイル名だけの親 testcase（成功）は数えない。失敗は残す", () => {
    const xml = `<testsuite name="s" hostname="h"><testcase name="x.test.js" classname="test" time="0"/>
<testcase name="y.test.js" classname="test" time="0"><failure message="boom"/></testcase></testsuite>`;
    const cases = parseJunitSuites(xml, "junit/backend-junit.xml");
    assert.deepEqual(
      cases.map((c) => [c.name, c.status]),
      [["y.test.js", "failed"]],
    );
  });

  it("TC-ID をテスト名から集める（重複は 1 つ）", () => {
    assert.deepEqual(tcIdsOf("[TC-021] [TC-024] 文言 [TC-021]"), ["TC-021", "TC-024"]);
  });
});

describe("観察値 → actual_result", () => {
  const entry = {
    screen: {
      row_count: 2,
      rows: [
        { text: "買い物", checked: false, busy: false },
        { text: "掃除", checked: true, busy: false },
      ],
      rows_omitted: 0,
      input_value: "",
      save_error: "保存できませんでした。もう一度お試しください",
      input_error: "",
      list_message: "",
      focus: null,
    },
    api_calls: [
      { method: "GET", path: "/api/v1/tasks", status: 200 },
      {
        method: "PATCH",
        path: "/api/v1/tasks/5f1b0c1e-1111-4a11-8a11-000000000001",
        status: 503,
        response: '{"error":{"code":"STORAGE_FAILURE"',
      },
      {
        method: "PATCH",
        path: "/api/v1/tasks/{uuid}",
        status: 503,
        response: '{"error":{"code":"STORAGE_FAILURE"',
      },
    ],
    notes: [{ label: "p95", value: "12ms" }],
    table: [{ input: '""', result: "不合格 TITLE_REQUIRED" }],
  };

  it("画面・通信・計測・入力→結果から、観察した事実だけの文を組む", () => {
    const text = describeEntry(entry);
    assert.match(text, /一覧 2 行 \[買い物, 掃除\(済\)\]/);
    assert.match(text, /入力欄は空/);
    assert.match(text, /保存エラー「保存できませんでした。もう一度お試しください」/);
    assert.match(
      text,
      /API: GET \/api\/v1\/tasks→200, PATCH \/api\/v1\/tasks\/\{id\}→503 STORAGE_FAILURE ×2/,
    );
    assert.match(text, /p95: 12ms/);
    assert.match(text, /入力→結果 1 件: ""→不合格 TITLE_REQUIRED/);
  });

  it("UUID は {id} に伏せる（0 の並ぶ UUID が電話番号の検査に当たらないように）", () => {
    const text = actualResultOf([
      { notes: [{ label: "id", value: "00000000-0000-4000-8000-000000000001" }] },
    ]);
    assert.equal(text, "id: {id}");
  });

  it("連続する同じ呼び出しは ×n にまとめ、複数のテストは (1) (2) で並べる", () => {
    assert.equal(
      callsText([
        { method: "POST", path: "/api/v1/tasks", status: 201 },
        { method: "POST", path: "/api/v1/tasks", status: 201 },
      ]),
      "API: POST /api/v1/tasks→201 ×2",
    );
    assert.equal(
      actualResultOf([{ notes: [{ label: "a", value: "1" }] }, { notes: [{ label: "b", value: "2" }] }]),
      "(1) a: 1 (2) b: 2",
    );
  });

  it("長い文は切り、切ったことが分かる", () => {
    assert.equal(clipText("あ".repeat(10), 5), "あああああ".slice(0, 4) + "…");
  });
});
