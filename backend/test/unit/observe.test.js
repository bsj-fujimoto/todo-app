// 観察値の採取（test-support/observe.js）自体の確認。時刻は注入した固定値、書き出し先は一時ディレクトリ。
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  LIMITS,
  buildEntry,
  clip,
  createObservations,
  describeText,
  describeValidation,
  mergeEntry,
  summarizeCall,
  tcIdsOf,
  writeEntry,
} from "../../test-support/observe.js";

const NOW = "2026-10-11T00:00:00.000Z";

describe("観察値の採取", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "observe-test-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("[補助] 文字数（コードポイント）で切り、UUID は {uuid} に伏せる", () => {
    assert.equal(clip("😀".repeat(5), 3), "😀😀😀…(5文字)");
    assert.equal(clip("id 5f1b0c1e-1111-4a11-8a11-000000000001", 80), "id {uuid}");
    assert.equal(describeText("a".repeat(30)), `"${"a".repeat(12)}"…(30コードポイント)`);
    assert.equal(describeValidation({ ok: false, code: "TITLE_REQUIRED" }), "不合格 TITLE_REQUIRED");
    assert.equal(describeValidation({ ok: true, title: "買い物" }), '合格 title="買い物"');
  });

  it("[補助] API 呼び出しは method path → status と、応答・要求の要約（大きな本文は長さだけ）", () => {
    const call = summarizeCall({
      method: "POST",
      path: "/api/v1/tasks",
      status: 422,
      request: { title: "x" },
      response: { error: { code: "TITLE_REQUIRED" } },
    });
    assert.deepEqual(call, {
      method: "POST",
      path: "/api/v1/tasks",
      status: 422,
      request: '{"title":"x"}',
      response: '{"error":{"code":"TITLE_REQUIRED"}}',
    });
    assert.match(
      summarizeCall({ method: "POST", path: "/", status: 400, request: "x".repeat(5000) }).request,
      /^\(5000 バイト\)$/,
    );
  });

  it("[補助] 上限を超える呼び出し・note・表は切り、切った件数を残す。TC-ID はタイトルから取る", () => {
    const obs = createObservations({ layer: "api", component: "backend", clock: () => NOW });
    for (let i = 0; i < LIMITS.calls + 5; i += 1)
      obs.call({ method: "GET", path: "/api/v1/tasks", status: 200 });
    obs.note("p95", "12ms");
    obs.set("画面", "1 回目");
    obs.set("画面", "2 回目");
    obs.row("入力", "結果");
    const entry = buildEntry({ obs, title: "[TC-001] [TC-002] 例", outcome: "passed", clock: () => NOW });
    assert.equal(entry.api_calls.length, LIMITS.calls);
    assert.equal(entry.api_calls_omitted, 5);
    assert.deepEqual(
      entry.notes.map((n) => [n.label, n.value]),
      [
        ["p95", "12ms"],
        ["画面", "2 回目"],
      ],
    );
    assert.deepEqual(entry.test_case_ids, ["TC-001", "TC-002"]);
    assert.deepEqual([entry.started_at, entry.finished_at, entry.duration_ms], [NOW, NOW, 0]);
    assert.equal(entry.environment.node, process.version);
    assert.deepEqual(tcIdsOf("[TC-009] [TC-009] x"), ["TC-009"]);
  });

  it("[補助] 同じ TC の複数テストは 1 つのファイルの entries に並び、再実行しても増えない", async () => {
    const make = (title) =>
      buildEntry({
        obs: createObservations({ layer: "api", component: "backend", clock: () => NOW }),
        title,
        outcome: "passed",
        clock: () => NOW,
      });
    const nameFor = (tc) => tc;
    writeEntry({ dir, entry: make("[TC-008] 1 つ目"), nameFor });
    writeEntry({ dir, entry: make("[TC-008] 2 つ目"), nameFor });
    writeEntry({ dir, entry: make("[TC-008] 1 つ目"), nameFor }); // 同じタイトルは置き換え
    const doc = JSON.parse(await readFile(path.join(dir, "TC-008.json"), "utf8"));
    assert.equal(doc.test_case_id, "TC-008");
    assert.deepEqual(doc.entries.map((e) => e.title).sort(), ["[TC-008] 1 つ目", "[TC-008] 2 つ目"]);
    assert.equal(
      mergeEntry({ dir, name: "TC-009", tcId: "TC-009", entry: make("[TC-009] x") }),
      path.join(dir, "TC-009.json"),
    );
  });
});
