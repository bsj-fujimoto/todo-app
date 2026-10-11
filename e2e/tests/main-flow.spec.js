// 主要シナリオ: TC-001（追加→完了切替→削除→再読込）、TC-041（再読込後の保持）、TC-070（ブラウザ互換）。
import { test, expect } from "../fixtures/stack.js";
import { DS002, DS002_TITLES } from "../fixtures/data.js";

const summary = (calls) => calls.map((c) => `${c.method} ${c.status}`);

test(
  "[TC-001] 追加・完了切替・削除・再読込が一連で動き、結果が保持される",
  { tag: ["@smoke", "@cross-browser"] },
  async ({ app, stack }) => {
    await stack.seed(DS002);
    await app.open();
    await app.expectTitles(DS002_TITLES);

    // 追加（先頭に増え、入力欄は空）
    await app.add("資料を印刷する");
    await app.expectTitles(["資料を印刷する", ...DS002_TITLES]);
    await expect(app.input).toHaveValue("");
    await app.expectStrikethrough("資料を印刷する", false);

    // 完了 → 未完了（取り消し線が切り替わり、並びは先頭のまま）
    await app.checkbox("資料を印刷する").click();
    await expect(app.checkbox("資料を印刷する")).toBeChecked();
    await app.expectStrikethrough("資料を印刷する", true);
    await app.checkbox("資料を印刷する").click();
    await expect(app.checkbox("資料を印刷する")).not.toBeChecked();
    await app.expectStrikethrough("資料を印刷する", false);
    await app.expectTitles(["資料を印刷する", ...DS002_TITLES]);

    // 削除
    await app.deleteButton("牛乳を買う").click();
    const expected = ["資料を印刷する", "打ち合わせの準備をする", "仕様書をレビューする"];
    await app.expectTitles(expected);

    // 再読込しても同じ
    await app.page.reload();
    await app.expectTitles(expected);
    await expect(app.checkbox("打ち合わせの準備をする")).toBeChecked();
    await expect(app.checkbox("仕様書をレビューする")).not.toBeChecked();
    await expect(app.checkbox("資料を印刷する")).not.toBeChecked();
    await app.expectNoErrors();

    // API: POST 201 / PATCH 200 ×2 / DELETE 204、GET は 200
    expect(summary(stack.calls("POST"))).toEqual(["POST 201"]);
    expect(stack.calls("PATCH").map((c) => [c.status, c.requestBody])).toEqual([
      [200, { completed: true }],
      [200, { completed: false }],
    ]);
    expect(summary(stack.calls("DELETE"))).toEqual(["DELETE 204"]);
    expect(stack.calls("GET").map((c) => c.status)).toEqual([200, 200]);

    // DB（保存データ）
    expect((await stack.db()).map((t) => [t.title, t.completed])).toEqual([
      ["仕様書をレビューする", false],
      ["打ち合わせの準備をする", true],
      ["資料を印刷する", false],
    ]);
  },
);

test(
  "[TC-041] 追加・完了切替・削除の結果が、再読込のたびに保持される",
  { tag: ["@smoke"] },
  async ({ app, stack }) => {
    await app.open();
    await app.add("買い物");
    await app.page.reload();
    await app.expectTitles(["買い物"]);
    await app.expectNoErrors();

    await app.add("資料を印刷する");
    await app.checkbox("資料を印刷する").click();
    await expect(app.checkbox("資料を印刷する")).toBeChecked();
    await app.page.reload();
    await app.expectTitles(["資料を印刷する", "買い物"]);
    await expect(app.checkbox("資料を印刷する")).toBeChecked();
    await app.expectStrikethrough("資料を印刷する", true);
    await expect(app.checkbox("買い物")).not.toBeChecked();
    await app.expectNoErrors();

    await app.deleteButton("買い物").click();
    await app.page.reload();
    await app.expectTitles(["資料を印刷する"]);
    await expect(app.checkbox("資料を印刷する")).toBeChecked();
    await app.expectNoErrors();

    expect(stack.calls("GET").map((c) => c.status)).toEqual([200, 200, 200, 200]);
    expect((await stack.db()).map((t) => [t.title, t.completed])).toEqual([["資料を印刷する", true]]);
  },
);

test(
  "[TC-070] 3 ブラウザで同じ結果になる（追加→完了→再読込→削除）",
  { tag: ["@compat", "@cross-browser"] },
  async ({ app, stack }) => {
    await app.open();
    await app.add("資料を印刷する", "enter");
    await app.expectTitles(["資料を印刷する"]);
    await expect(app.input).toHaveValue("");

    await app.checkbox("資料を印刷する").click();
    await app.expectStrikethrough("資料を印刷する", true);

    await app.page.reload();
    await app.expectTitles(["資料を印刷する"]);
    await expect(app.checkbox("資料を印刷する")).toBeChecked();
    await app.expectStrikethrough("資料を印刷する", true);

    await app.deleteButton("資料を印刷する").click();
    await expect(app.emptyMessage).toBeVisible();
    await app.expectNoErrors();

    expect(summary(stack.calls("POST"))).toEqual(["POST 201"]);
    expect(summary(stack.calls("PATCH"))).toEqual(["PATCH 200"]);
    expect(summary(stack.calls("DELETE"))).toEqual(["DELETE 204"]);
    expect(await stack.db()).toEqual([]);
  },
);
