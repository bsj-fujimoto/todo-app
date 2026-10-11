// 二重送信・並行操作（暫定期待値を含む。未決 UNK-003・UNK-004）: TC-063（連打）、TC-066（別タブで削除済みの行の操作）。
import { test, expect } from "../fixtures/stack.js";
import { DS002, DS002_TITLES } from "../fixtures/data.js";
import { MESSAGE } from "../fixtures/todo-app.js";

test(
  "[TC-063] 追加ボタンの連打は送信中に無効化され、1 件だけ追加される（暫定: UNK-004）",
  { tag: ["@pending"] },
  async ({ app, stack, page }) => {
    // POST の応答を保留して「送信中」を作る（DS-012 の遅延を、固定時間ではなく条件で再現する）
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const posts = [];
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posts.push(route.request().postData());
      await gate;
      return route.fallback();
    });
    await app.open();

    await app.input.fill("連打確認");
    for (let i = 0; i < 5; i += 1) await app.addButton.click({ force: true }); // 無効化後のクリックは何も起こさない
    await expect(app.addButton).toBeDisabled();
    expect(posts).toHaveLength(1);

    release();
    await app.expectTitles(["連打確認"]);
    await expect(app.addButton).toBeEnabled();
    await page.reload();
    await app.expectTitles(["連打確認"]);

    expect(stack.calls("POST").map((c) => c.status)).toEqual([201]);
    expect((await stack.db()).map((t) => t.title)).toEqual(["連打確認"]);
  },
);

test(
  "[TC-066] 別タブで削除済みの行を操作すると保存失敗の文言を出し、再読込で一覧が揃う（暫定: UNK-003）",
  { tag: ["@pending"] },
  async ({ app, stack, context }) => {
    await stack.seed(DS002);
    await app.open();
    const tabB = await context.newPage();
    await tabB.goto("/");
    const other = { checkbox: (title) => tabB.getByRole("checkbox", { name: `「${title}」を完了にする` }) };
    await expect(tabB.locator("li.task .task-title")).toHaveText(DS002_TITLES);

    // タブ A で削除
    await app.deleteButton("仕様書をレビューする").click();
    await app.expectTitles(["打ち合わせの準備をする", "牛乳を買う"]);

    // タブ B（再読込なし）でチェック
    await other.checkbox("仕様書をレビューする").click();
    await expect(tabB.locator("#save-error")).toHaveText(MESSAGE.storageFailure);
    await expect(other.checkbox("仕様書をレビューする")).not.toBeChecked();
    await expect(
      tabB.locator("li.task .task-title").filter({ hasText: "仕様書をレビューする" }),
    ).not.toHaveCSS("text-decoration-line", "line-through");
    const patch = stack.calls("PATCH");
    expect(patch).toHaveLength(1);
    expect([patch[0].status, patch[0].responseBody.error.code]).toEqual([404, "TASK_NOT_FOUND"]);

    await tabB.reload();
    await expect(tabB.locator("li.task .task-title")).toHaveText(["打ち合わせの準備をする", "牛乳を買う"]);
    expect(await stack.db()).toEqual([DS002[0], DS002[2]]); // 仕様書をレビューする だけが消え、復活しない
  },
);
