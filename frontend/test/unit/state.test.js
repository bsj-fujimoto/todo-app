// state: 画面状態の純粋な遷移。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, controlsEnabled, initialState, reduce } from "../../src/state.js";
import { task } from "./dom.js";
import { observeState } from "../../../backend/test-support/observe-frontend.js";

// 前提の準備（ready）は観察しない。テストが検証する遷移の結果（run）だけを、実際に得た状態として残す。
const run = (state, ...actions) => {
  const result = actions.reduce(reduce, state);
  observeState(result);
  return result;
};
const ready = (...tasks) => [{ type: "load-succeeded", tasks }].reduce(reduce, initialState());
const fail = (code, status = 500) => ({ ok: false, status, code });

describe("state", () => {
  it("初期は loading で、一覧は空・エラーなし。操作できない", () => {
    const state = initialState();
    assert.equal(state.phase, "loading");
    assert.deepEqual(state.tasks, []);
    assert.equal(state.topError, null);
    assert.equal(controlsEnabled(state), false);
  });

  it("[TC-056] 取得成功 0 件は ready（空状態）で操作できる", () => {
    const state = ready();
    assert.equal(state.phase, "ready");
    assert.equal(state.tasks.length, 0);
    assert.equal(controlsEnabled(state), true);
  });

  it("[TC-058] 取得失敗は load-error。0 件の ready にはならず、保存失敗の文言を出す", () => {
    const state = run(initialState(), { type: "load-failed", failure: fail("NETWORK_ERROR", 0) });
    assert.equal(state.phase, "load-error");
    assert.equal(state.topError, "STORAGE_FAILURE");
    assert.equal(controlsEnabled(state), false);
  });

  it("[TC-055] 取得で DATA_CORRUPT は corrupt。操作を止め、一覧は持たない", () => {
    const state = run(ready(task(1)), { type: "load-failed", failure: fail("DATA_CORRUPT") });
    assert.equal(state.phase, "corrupt");
    assert.equal(state.topError, "DATA_CORRUPT");
    assert.deepEqual(state.tasks, []);
    assert.equal(controlsEnabled(state), false);
  });

  it("再読み込みを始めると loading に戻り、上部エラーを消す", () => {
    const failed = run(initialState(), { type: "load-failed", failure: fail("UNKNOWN", 502) });
    const state = run(failed, { type: "load-started" });
    assert.equal(state.phase, "loading");
    assert.equal(state.topError, null);
  });

  it("追加成功は先頭に足す（新しいものが先）", () => {
    const state = run(ready(task(1)), { type: "submit-started" }, { type: "task-added", task: task(2) });
    assert.deepEqual(
      state.tasks.map((t) => t.id),
      [task(2).id, task(1).id],
    );
    assert.equal(state.submitting, false);
  });

  it("[TC-063] 送信中は submitting。成功・失敗のどちらでも解除される", () => {
    const started = run(ready(), { type: "submit-started" });
    assert.equal(started.submitting, true);
    assert.equal(
      run(started, { type: "submit-failed", failure: fail("STORAGE_FAILURE", 503) }).submitting,
      false,
    );
  });

  it("[TC-045] 保存失敗は上部エラー。一覧は変わらない", () => {
    const state = run(
      ready(task(1)),
      { type: "submit-started" },
      { type: "submit-failed", failure: fail("STORAGE_FAILURE", 503) },
    );
    assert.equal(state.topError, "STORAGE_FAILURE");
    assert.equal(state.inputError, null);
    assert.equal(state.tasks.length, 1);
  });

  it("サーバーの 422 は入力欄の直下のエラー（上部には出さない）", () => {
    const state = run(
      ready(),
      { type: "submit-started" },
      { type: "submit-failed", failure: fail("TITLE_TOO_LONG", 422) },
    );
    assert.equal(state.inputError, "TITLE_TOO_LONG");
    assert.equal(state.topError, null);
  });

  it("次の操作を始めると上部エラーが消え、入力編集で入力エラーが消える", () => {
    const failed = run(
      ready(task(1)),
      { type: "op-started", id: task(1).id },
      { type: "op-failed", id: task(1).id, failure: fail("STORAGE_FAILURE", 503) },
    );
    assert.equal(failed.topError, "STORAGE_FAILURE");
    assert.equal(run(failed, { type: "op-started", id: task(1).id }).topError, null);
    assert.equal(
      run(failed, { type: "input-invalid", code: "TITLE_REQUIRED" }, { type: "input-edited" }).inputError,
      null,
    );
  });

  it("[TC-008] 完了切替は対象だけ置き換え、並びは変えない", () => {
    const state = run(
      ready(task(3), task(2), task(1)),
      { type: "op-started", id: task(2).id },
      { type: "task-updated", task: task(2, { completed: true }) },
    );
    assert.deepEqual(
      state.tasks.map((t) => [t.id, t.completed]),
      [
        [task(3).id, false],
        [task(2).id, true],
        [task(1).id, false],
      ],
    );
    assert.deepEqual(state.busyIds, []);
  });

  it("[TC-013] 削除は対象だけ消す", () => {
    const state = run(
      ready(task(2), task(1)),
      { type: "op-started", id: task(2).id },
      { type: "task-removed", id: task(2).id },
    );
    assert.deepEqual(
      state.tasks.map((t) => t.id),
      [task(1).id],
    );
  });

  it("[TC-066] 404 は保存失敗の文言（UNK-003）。対象の行は残る", () => {
    const state = run(
      ready(task(1)),
      { type: "op-started", id: task(1).id },
      { type: "op-failed", id: task(1).id, failure: fail("TASK_NOT_FOUND", 404) },
    );
    assert.equal(state.topError, "STORAGE_FAILURE");
    assert.equal(state.tasks.length, 1);
  });

  it("操作中に DATA_CORRUPT が返ったら corrupt へ移り操作を止める", () => {
    const state = run(
      ready(task(1)),
      { type: "op-started", id: task(1).id },
      { type: "op-failed", id: task(1).id, failure: fail("DATA_CORRUPT") },
    );
    assert.equal(state.phase, "corrupt");
    assert.equal(controlsEnabled(state), false);
  });

  it("未知のアクションは状態を変えない", () => {
    const state = ready();
    assert.equal(reduce(state, { type: "nope" }), state);
  });

  it("classifyFailure", () => {
    assert.deepEqual(classifyFailure(fail("DATA_CORRUPT")), { kind: "corrupt" });
    assert.deepEqual(classifyFailure(fail("TITLE_MULTILINE", 422)), {
      kind: "input",
      code: "TITLE_MULTILINE",
    });
    for (const code of ["STORAGE_FAILURE", "INVALID_REQUEST", "TASK_NOT_FOUND", "UNKNOWN", "NETWORK_ERROR"]) {
      assert.deepEqual(classifyFailure(fail(code)), { kind: "save" });
    }
  });
});
