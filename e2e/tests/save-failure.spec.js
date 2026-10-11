// 保存失敗・通信断・backend 停止: TC-045〜TC-049。障害注入は page.route（DS-012）と、実際の backend プロセス停止の両方。
import { test, expect } from "../fixtures/stack.js";
import { DS002, DS002_TITLES, STORAGE_FAILURE_RESPONSE } from "../fixtures/data.js";
import { MESSAGE } from "../fixtures/todo-app.js";

/** 指定メソッドの /api/v1/tasks 系リクエストに 503 STORAGE_FAILURE を返し、呼ばれた回数を数える。 */
async function injectStorageFailure(page, method) {
  const hits = [];
  await page.route("**/api/v1/tasks**", (route) => {
    if (route.request().method() !== method) return route.fallback();
    hits.push(route.request().url());
    return route.fulfill(STORAGE_FAILURE_RESPONSE);
  });
  return hits;
}

test.describe("画面から見た保存失敗（503 STORAGE_FAILURE を注入）", () => {
  test(
    "[TC-045] 追加の保存失敗は上部に文言を出し、入力値を保持し、一覧は変わらない",
    { tag: ["@resilience"] },
    async ({ app, stack, page }) => {
      await stack.seed(DS002);
      const hits = await injectStorageFailure(page, "POST");
      await app.open();
      await app.expectTitles(DS002_TITLES);

      await app.input.fill("資料を印刷する");
      await app.addButton.click();

      await expect(app.saveError).toHaveText(MESSAGE.storageFailure);
      await expect(app.input).toHaveValue("資料を印刷する");
      await app.expectTitles(DS002_TITLES);
      await expect(app.inputError).toHaveText("");
      await expect(app.addButton).toBeEnabled();
      expect(hits).toHaveLength(1);
      expect((await stack.tasks()).body.tasks).toHaveLength(3);
    },
  );

  test(
    "[TC-046] 完了切替の保存失敗は上部に文言を出し、チェックは元のまま",
    { tag: ["@resilience"] },
    async ({ app, stack, page }) => {
      await stack.seed(DS002);
      const hits = await injectStorageFailure(page, "PATCH");
      await app.open();

      await app.checkbox("牛乳を買う").click();

      await expect(app.saveError).toHaveText(MESSAGE.storageFailure);
      await expect(app.checkbox("牛乳を買う")).not.toBeChecked();
      await app.expectStrikethrough("牛乳を買う", false);
      await app.expectTitles(DS002_TITLES);
      expect(hits).toHaveLength(1);
      expect((await stack.tasks()).body.tasks.map((t) => t.completed)).toEqual([true, false, false]);
    },
  );

  test(
    "[TC-047] 削除の保存失敗は上部に文言を出し、行は残る",
    { tag: ["@resilience"] },
    async ({ app, stack, page }) => {
      await stack.seed(DS002);
      const hits = await injectStorageFailure(page, "DELETE");
      await app.open();

      await app.deleteButton("仕様書をレビューする").click();

      await expect(app.saveError).toHaveText(MESSAGE.storageFailure);
      await app.expectTitles(DS002_TITLES);
      await expect(app.checkbox("打ち合わせの準備をする")).toBeChecked();
      expect(hits).toHaveLength(1);
      expect((await stack.tasks()).body.tasks).toHaveLength(3);
    },
  );
});

test(
  "[TC-048] 通信断では入力値を保持し、復帰後の同じ操作で 1 件だけ追加される",
  { tag: ["@resilience"] },
  async ({ app, stack, context }) => {
    await stack.seed(DS002);
    await app.open();
    await app.expectTitles(DS002_TITLES);
    stack.clearRequests();

    await context.setOffline(true);
    await app.input.fill("資料を印刷する");
    await app.addButton.click();

    await expect(app.saveError).toHaveText(MESSAGE.storageFailure);
    await expect(app.input).toHaveValue("資料を印刷する");
    await app.expectTitles(DS002_TITLES);
    expect(stack.calls("POST")).toHaveLength(0); // backend は POST を受信しない
    expect((await stack.tasks()).body.tasks).toHaveLength(3);

    await context.setOffline(false);
    await app.addButton.click();

    await expect(app.saveError).toHaveText("");
    await app.expectTitles(["資料を印刷する", ...DS002_TITLES]);
    await expect(app.input).toHaveValue("");
    expect(stack.calls("POST").map((c) => c.status)).toEqual([201]);
    expect((await stack.tasks()).body.tasks.filter((t) => t.title === "資料を印刷する")).toHaveLength(1);
  },
);

test(
  "[TC-049] backend 停止中は保存失敗を表示し、再起動後の同じ操作で重複なく追加される",
  { tag: ["@resilience"] },
  async ({ app, stack }) => {
    await stack.seed(DS002);
    await app.open();
    await app.expectTitles(DS002_TITLES);
    stack.clearRequests();

    await stack.stopBackend();
    await app.input.fill("資料を印刷する");
    await app.addButton.click();

    await expect(app.saveError).toHaveText(MESSAGE.storageFailure);
    await expect(app.input).toHaveValue("資料を印刷する");
    await app.expectTitles(DS002_TITLES);
    expect(stack.calls("POST").map((c) => c.status)).toEqual([502]); // 中継の 502（nginx 相当）

    await stack.startBackend();
    await app.addButton.click();

    await expect(app.saveError).toHaveText("");
    await app.expectTitles(["資料を印刷する", ...DS002_TITLES]);
    await expect(app.input).toHaveValue("");
    expect(stack.calls("POST").map((c) => c.status)).toEqual([502, 201]);

    await app.page.reload();
    await app.expectTitles(["資料を印刷する", ...DS002_TITLES]);
    const { body } = await stack.tasks();
    expect(body.tasks.map((t) => t.title)).toEqual(["資料を印刷する", ...DS002_TITLES]);
  },
);
