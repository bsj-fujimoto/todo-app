// app + view: イベント → API → 描画の結合（DOM は happy-dom、API は偽物）。ブラウザ・ネットワークを使わない。
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/app.js";
import { createView } from "../../src/view.js";
import { createDocument, task } from "./dom.js";
import { observeScreenAtEnd } from "./observer.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const ok = (data) => ({ ok: true, data });
const ng = (code, status = 503) => ({ ok: false, status, code });

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup(initial = [], overrides = {}) {
  const { window, document } = createDocument();
  const calls = [];
  const record =
    (name, impl) =>
    async (...args) => {
      calls.push([name, ...args]);
      return impl(...args);
    };
  const defaults = {
    listTasks: async () => ok(initial),
    createTask: async (title) => ok(task(9, { title })),
    updateTask: async (id, completed) => ok({ ...initial.find((t) => t.id === id), completed }),
    deleteTask: async () => ok(null),
  };
  const names = { listTasks: "list", createTask: "create", updateTask: "update", deleteTask: "delete" };
  const api = Object.fromEntries(
    Object.entries(defaults).map(([key, impl]) => [key, record(names[key], overrides[key] ?? impl)]),
  );
  const view = createView(document);
  const app = createApp({ api, view });
  view.bind(app.handlers);

  const $ = (selector) => document.querySelector(selector);
  const ui = {
    document,
    calls,
    app,
    input: $("#title-input"),
    add: $("#add-button"),
    saveError: $("#save-error"),
    inputError: $("#input-error"),
    message: $("#list-message"),
    titles: () => [...document.querySelectorAll(".task-title")].map((el) => el.textContent),
    row: (n) => document.querySelectorAll("li.task")[n],
    type(text) {
      ui.input.value = text;
      ui.input.dispatchEvent(new window.Event("input", { bubbles: true }));
    },
    submit() {
      $("#add-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    },
    toggle(n, checked) {
      const box = ui.row(n).querySelector(".task-check");
      box.checked = checked;
      box.dispatchEvent(new window.Event("change", { bubbles: true }));
    },
    remove: (n) => ui.row(n).querySelector("button.delete").click(),
  };
  observeScreenAtEnd(ui);
  return ui;
}

const three = [task(3), task(2, { completed: true }), task(1)];

describe("app", () => {
  describe("起動", () => {
    it("[TC-057] 取得前は「読み込み中…」を出し、「タスクはありません」を出さない。操作は無効", async () => {
      const pending = deferred();
      const ui = setup([], { listTasks: async () => pending.promise });
      ui.app.start();
      assert.equal(ui.message.textContent, "読み込み中…");
      assert.equal(ui.input.disabled, true);
      assert.equal(ui.add.disabled, true);
      pending.resolve(ok(three));
      await flush();
      assert.deepEqual(ui.titles(), ["タスク3", "タスク2", "タスク1"]);
      assert.equal(ui.message.hidden, true);
      assert.equal(ui.input.disabled, false);
    });

    it("[TC-056] 0 件は「タスクはありません」。エラー領域は空", async () => {
      const ui = setup([]);
      await ui.app.start();
      assert.equal(ui.message.textContent, "タスクはありません");
      assert.equal(ui.saveError.textContent, "");
      assert.equal(ui.inputError.textContent, "");
    });

    it("[TC-058] 取得失敗は 0 件と誤認させず、保存失敗の文言と再読み込みボタンを出す。再読み込みで回復する", async () => {
      let fails = true;
      const ui = setup(three, { listTasks: async () => (fails ? ng("NETWORK_ERROR", 0) : ok(three)) });
      await ui.app.start();
      assert.equal(ui.message.textContent, "");
      assert.equal(ui.saveError.textContent, "保存できませんでした。もう一度お試しください");
      assert.equal(ui.input.disabled, true);
      const retry = ui.document.querySelector("#retry-button");
      assert.equal(retry.hidden, false);
      fails = false;
      retry.click();
      await flush();
      assert.equal(ui.titles().length, 3);
      assert.equal(ui.saveError.textContent, "");
      assert.equal(retry.hidden, true);
    });

    it("[TC-055] DATA_CORRUPT は文言を出し、入力・追加を無効化し、「タスクはありません」を出さない。POST も送らない", async () => {
      const ui = setup([], { listTasks: async () => ng("DATA_CORRUPT", 500) });
      await ui.app.start();
      assert.equal(ui.saveError.textContent, "保存データを読み込めませんでした");
      assert.equal(ui.message.textContent, "");
      assert.equal(ui.input.disabled, true);
      assert.equal(ui.add.disabled, true);
      ui.type("資料を印刷する");
      ui.submit();
      await flush();
      assert.deepEqual(
        ui.calls.map((c) => c[0]),
        ["list"],
      );
    });
  });

  describe("追加", () => {
    let ui;
    beforeEach(async () => {
      ui = setup(three);
      await ui.app.start();
    });

    it("[TC-003] 成功すると先頭に増え、入力欄は空になり、フォーカスは入力欄に戻る", async () => {
      ui.type("  買い物  ");
      ui.submit();
      await flush();
      assert.deepEqual(ui.calls.at(-1), ["create", "買い物"]);
      assert.equal(ui.titles()[0], "買い物");
      assert.equal(ui.titles().length, 4);
      assert.equal(ui.input.value, "");
      assert.equal(ui.document.activeElement, ui.input);
    });

    it("[TC-016] 空欄はクライアント側で検証し、POST を送らず入力欄の直下にエラーを出す", async () => {
      ui.type("   ");
      ui.submit();
      await flush();
      assert.equal(ui.inputError.textContent, "タスク名を入力してください");
      assert.equal(ui.input.getAttribute("aria-invalid"), "true");
      assert.equal(ui.input.nextElementSibling, ui.inputError);
      assert.equal(ui.saveError.textContent, "");
      assert.equal(ui.calls.filter((c) => c[0] === "create").length, 0);
    });

    it("[TC-017] 101 文字は長さのエラー、入力すると消える", async () => {
      ui.type("a".repeat(101));
      ui.submit();
      assert.equal(ui.inputError.textContent, "タスク名は100文字以内で入力してください");
      ui.type("a");
      assert.equal(ui.inputError.textContent, "");
      assert.equal(ui.input.hasAttribute("aria-invalid"), false);
    });

    it("[TC-045] 保存失敗は上部に文言を出し、入力値を保持し、一覧は変えない", async () => {
      const failing = setup(three, { createTask: async () => ng("STORAGE_FAILURE") });
      await failing.app.start();
      failing.type("資料を印刷する");
      failing.submit();
      await flush();
      assert.equal(failing.saveError.textContent, "保存できませんでした。もう一度お試しください");
      assert.equal(failing.input.value, "資料を印刷する");
      assert.equal(failing.titles().length, 3);
      assert.equal(failing.inputError.textContent, "");
      assert.equal(failing.add.disabled, false);
    });

    it("サーバーの 422 も入力欄の直下に出す（入力値は保持）", async () => {
      const server = setup(three, { createTask: async () => ng("TITLE_MULTILINE", 422) });
      await server.app.start();
      server.type("abc");
      server.submit();
      await flush();
      assert.equal(server.inputError.textContent, "タスク名は1行で入力してください");
      assert.equal(server.input.value, "abc");
      assert.equal(server.saveError.textContent, "");
    });

    it("[TC-061] 送信中に打った次の入力は、先の追加の成功で消さない（Issue #6 の回帰）", async () => {
      const pending = deferred();
      const slow = setup([], { createTask: async () => pending.promise });
      await slow.app.start();
      slow.type("A");
      slow.submit();
      slow.type("B"); // A の応答が返る前に次を入力する
      pending.resolve(ok(task(9, { title: "A" })));
      await flush();
      assert.deepEqual(slow.titles(), ["A"]);
      assert.equal(slow.input.value, "B");
    });

    it("[TC-063] 送信中は追加ボタンを無効化し、連打しても POST は 1 回だけ", async () => {
      const pending = deferred();
      const slow = setup([], { createTask: async () => pending.promise });
      await slow.app.start();
      slow.type("連打確認");
      for (let i = 0; i < 5; i += 1) slow.submit();
      assert.equal(slow.add.disabled, true);
      pending.resolve(ok(task(9, { title: "連打確認" })));
      await flush();
      assert.equal(slow.calls.filter((c) => c[0] === "create").length, 1);
      assert.deepEqual(slow.titles(), ["連打確認"]);
      assert.equal(slow.add.disabled, false);
    });
  });

  describe("完了切替・削除", () => {
    let ui;
    beforeEach(async () => {
      ui = setup(three);
      await ui.app.start();
    });

    it("[TC-008] 完了切替は成功後に取り消し線（done）と状態を反映し、並びは変わらない", async () => {
      const pending = deferred();
      const slow = setup(three, {
        updateTask: async (id, completed) => (await pending.promise, ok({ ...task(1), completed })),
      });
      await slow.app.start();
      slow.toggle(2, true);
      const box = () => slow.row(2).querySelector(".task-check");
      assert.equal(box().checked, false, "通信中も表示は元のまま");
      assert.equal(slow.row(2).classList.contains("done"), false, "成功前は反映しない");
      assert.equal(slow.row(2).getAttribute("aria-busy"), "true");
      pending.resolve();
      await flush();
      assert.equal(box().checked, true);
      assert.equal(slow.row(2).classList.contains("done"), true);
      assert.deepEqual(slow.titles(), ["タスク3", "タスク2", "タスク1"]);
      assert.deepEqual(slow.calls.at(-1), ["update", task(1).id, true]);
    });

    it("[TC-046] 完了切替の失敗は上部に文言を出し、チェックは通信中も失敗後も変化しない", async () => {
      const pending = deferred();
      const failing = setup(three, { updateTask: async () => pending.promise });
      await failing.app.start();
      failing.toggle(2, true);
      assert.equal(failing.row(2).querySelector(".task-check").checked, false, "通信中も最初から変化しない");
      pending.resolve(ng("STORAGE_FAILURE"));
      await flush();
      assert.equal(failing.saveError.textContent, "保存できませんでした。もう一度お試しください");
      assert.equal(failing.row(2).querySelector(".task-check").checked, false);
      assert.equal(failing.row(2).classList.contains("done"), false);
    });

    it("[TC-013] 削除は成功後に行が消える。確認は挟まない", async () => {
      ui.remove(1);
      assert.equal(ui.titles().length, 3, "成功前は消さない");
      await flush();
      assert.deepEqual(ui.titles(), ["タスク3", "タスク1"]);
    });

    it("[TC-047] 削除の失敗は上部に文言を出し、行は残る", async () => {
      const failing = setup(three, { deleteTask: async () => ng("STORAGE_FAILURE") });
      await failing.app.start();
      failing.remove(1);
      await flush();
      assert.equal(failing.saveError.textContent, "保存できませんでした。もう一度お試しください");
      assert.equal(failing.titles().length, 3);
    });

    it("[TC-014] 最後の 1 件を削除すると「タスクはありません」", async () => {
      const single = setup([task(1)]);
      await single.app.start();
      single.remove(0);
      await flush();
      assert.equal(single.message.textContent, "タスクはありません");
      assert.equal(single.titles().length, 0);
    });

    it("削除でフォーカス中の行が消えたら、近い行のチェックボックスへフォーカスを移す", async () => {
      const button = ui.row(1).querySelector("button.delete");
      button.focus();
      assert.equal(ui.document.activeElement, button);
      button.click();
      await flush();
      assert.equal(ui.document.activeElement, ui.row(1).querySelector(".task-check"));
    });

    it("最後の行を削除したときはフォーカスを一覧のメッセージへ移す", async () => {
      const single = setup([task(1)]);
      await single.app.start();
      const button = single.row(0).querySelector("button.delete");
      button.focus();
      button.click();
      await flush();
      assert.equal(single.document.activeElement, single.message);
    });

    it("[TC-008] 通信中の行の連打は 1 回だけ送り、別の行の操作は妨げない", async () => {
      const pending = deferred();
      const slow = setup(three, {
        updateTask: async (id, completed) =>
          id === task(1).id ? pending.promise : ok({ ...task(3), completed }),
      });
      await slow.app.start();
      slow.toggle(2, true);
      slow.toggle(2, true);
      slow.toggle(0, true); // 別の行
      await flush();
      assert.equal(slow.calls.filter((c) => c[0] === "update" && c[1] === task(1).id).length, 1);
      assert.equal(slow.row(0).classList.contains("done"), true);
      assert.equal(slow.row(2).classList.contains("done"), false);
      pending.resolve(ok({ ...task(1), completed: true }));
      await flush();
      assert.equal(slow.row(2).classList.contains("done"), true);
    });

    it("[TC-063] 通信中の行への重複操作は無視する", async () => {
      const pending = deferred();
      const slow = setup(three, { deleteTask: async () => pending.promise });
      await slow.app.start();
      slow.remove(0);
      slow.remove(0);
      pending.resolve(ok(null));
      await flush();
      assert.equal(slow.calls.filter((c) => c[0] === "delete").length, 1);
    });

    it("[TC-066] 他で削除済み（404）の行を操作すると保存失敗の文言（UNK-003）。行は残る", async () => {
      const gone = setup(three, { updateTask: async () => ng("TASK_NOT_FOUND", 404) });
      await gone.app.start();
      gone.toggle(2, true);
      await flush();
      assert.equal(gone.saveError.textContent, "保存できませんでした。もう一度お試しください");
      assert.equal(gone.row(2).querySelector(".task-check").checked, false);
    });
  });

  describe("並び替えの反映（行を作り直さない）", () => {
    it("追加で既存の行要素は再利用される", async () => {
      const ui = setup(three);
      await ui.app.start();
      const before = ui.row(0);
      ui.type("新規");
      ui.submit();
      await flush();
      assert.equal(ui.row(1), before);
    });
  });
});
