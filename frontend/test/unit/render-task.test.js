// TC-062: 一覧描画関数はタイトルを HTML として解釈しない（textContent のみ）。DS-005。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createDocument, TASK } from "./dom.js";
import { renderTask, updateTask } from "../../src/view.js";

const SRC = new URL("../../src/", import.meta.url);
const EVIL = [
  "<img src=x onerror=alert(1)>",
  "<script>alert(1)</script>",
  "&lt;b&gt;",
  '"><svg onload=alert(1)>',
  "'); DROP TABLE tasks;--",
];

describe("renderTask", () => {
  const { document } = createDocument();

  for (const title of EVIL) {
    it(`[TC-062] ${title} はテキストとして表示され、要素にならない`, () => {
      const row = renderTask(document, { ...TASK, title });
      assert.ok(row.textContent.includes(title));
      assert.equal(row.querySelector("img"), null);
      assert.equal(row.querySelector("script"), null);
      assert.equal(row.querySelector("svg"), null);
      assert.equal(row.querySelector(".task-title").textContent, title);
      assert.equal(row.querySelector(".task-title").children.length, 0);
    });
  }

  it("[TC-062] ソースに innerHTML 等の HTML 解釈 API の使用が 0 件", () => {
    const forbidden =
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|eval\(/;
    for (const file of readdirSync(SRC).filter((name) => name.endsWith(".js"))) {
      const source = readFileSync(new URL(file, SRC), "utf8");
      assert.doesNotMatch(source, forbidden, `${file} が HTML 解釈 API を使っている`);
    }
  });

  it("[TC-069] チェックボックスと削除ボタンのアクセシブルネームにタイトルが含まれる", () => {
    const row = renderTask(document, TASK);
    assert.equal(
      row.querySelector("input[type=checkbox]").getAttribute("aria-label"),
      "「牛乳を買う」を完了にする",
    );
    assert.equal(row.querySelector("button").getAttribute("aria-label"), "「牛乳を買う」を削除");
    assert.equal(row.querySelector("button").textContent, "削除");
  });

  it("完了タスクは done クラスとチェック状態を持つ", () => {
    const row = renderTask(document, { ...TASK, completed: true });
    assert.ok(row.classList.contains("done"));
    assert.equal(row.querySelector("input").checked, true);
  });

  it("通信中の行はチェック表示を上書きせず、完了後に状態へ揃える", () => {
    const row = renderTask(document, TASK);
    const checkbox = row.querySelector("input");
    checkbox.checked = true; // 利用者が押した直後
    updateTask(row, TASK, true);
    assert.equal(checkbox.checked, true);
    assert.equal(row.getAttribute("aria-busy"), "true");
    updateTask(row, TASK, false); // 失敗して未完了のまま
    assert.equal(checkbox.checked, false);
    assert.equal(row.getAttribute("aria-busy"), "false");
  });
});
