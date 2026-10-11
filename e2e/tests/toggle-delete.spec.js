// 完了切替・削除（状態遷移表 docs/03-test-spec.md §8.2 の画面側）: TC-008（ST-02, ST-03）、TC-013（ST-06）、TC-014（ST-06, ST-07）。
import { test, expect } from "../fixtures/stack.js";
import { DS002, DS002_TITLES } from "../fixtures/data.js";

const ids = (tasks) => tasks.map((t) => t.id);

test(
  "[TC-008] 完了にして未完了に戻すと、チェックと取り消し線が切り替わり、並びは変わらない [ST-02, ST-03]",
  { tag: ["@transition"] },
  async ({ app, stack }) => {
    await stack.seed(DS002);
    await app.open();
    await app.expectTitles(DS002_TITLES);
    const before = (await stack.tasks()).body.tasks;

    await app.checkbox("仕様書をレビューする").click();
    await expect(app.checkbox("仕様書をレビューする")).toBeChecked();
    await app.expectStrikethrough("仕様書をレビューする", true);
    await app.expectTitles(DS002_TITLES);
    const afterOn = (await stack.tasks()).body.tasks;
    expect(afterOn.map((t) => t.completed)).toEqual([true, true, false]);

    await app.checkbox("仕様書をレビューする").click();
    await expect(app.checkbox("仕様書をレビューする")).not.toBeChecked();
    await app.expectStrikethrough("仕様書をレビューする", false);
    await app.expectTitles(DS002_TITLES);
    const afterOff = (await stack.tasks()).body.tasks;

    // API: PATCH {completed:true} → 200、{completed:false} → 200
    expect(stack.calls("PATCH").map((c) => [c.status, c.requestBody])).toEqual([
      [200, { completed: true }],
      [200, { completed: false }],
    ]);
    // DB: completed が 0 → 1 → 0。title・createdAt・他の行は変わらない
    expect(afterOff).toEqual(before);
    expect(ids(afterOn)).toEqual(ids(before));
    expect(afterOn.map((t) => t.title)).toEqual(before.map((t) => t.title));
  },
);

test(
  "[TC-013] 削除は確認なしで即時に対象の行だけが消える [ST-06]",
  { tag: ["@transition"] },
  async ({ app, stack, page }) => {
    await stack.seed(DS002);
    const dialogs = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      dialog.dismiss();
    });
    await app.open();

    await app.deleteButton("仕様書をレビューする").click();

    await app.expectTitles(["打ち合わせの準備をする", "牛乳を買う"]);
    await expect(app.checkbox("打ち合わせの準備をする")).toBeChecked();
    await app.expectStrikethrough("打ち合わせの準備をする", true);
    await expect(app.checkbox("牛乳を買う")).not.toBeChecked();
    expect(dialogs).toEqual([]);
    await expect(page.getByText(/取り消し|元に戻す|Undo/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /取り消し|元に戻す|Undo/ })).toHaveCount(0);

    expect(stack.calls("DELETE").map((c) => c.status)).toEqual([204]);
    expect((await stack.tasks()).body.tasks.map((t) => t.title)).toEqual([
      "打ち合わせの準備をする",
      "牛乳を買う",
    ]);
  },
);

test(
  "[TC-014] 全件を削除すると「タスクはありません」になり、再読込後も同じ [ST-06, ST-07]",
  { tag: ["@transition"] },
  async ({ app, stack }) => {
    await stack.seed(DS002);
    await app.open();

    await app.deleteButton("打ち合わせの準備をする").click(); // 完了済みの行（ST-07）
    await app.expectTitles(["仕様書をレビューする", "牛乳を買う"]);
    await app.deleteButton("仕様書をレビューする").click();
    await app.expectTitles(["牛乳を買う"]);
    await app.deleteButton("牛乳を買う").click();
    await expect(app.emptyMessage).toBeVisible();
    await expect(app.rows).toHaveCount(0);

    await app.page.reload();
    await expect(app.emptyMessage).toBeVisible();
    await app.expectNoErrors();

    expect(stack.calls("DELETE").map((c) => c.status)).toEqual([204, 204, 204]);
    const last = stack.calls("GET").at(-1);
    expect([last.status, last.responseBody]).toEqual([200, { tasks: [] }]);
    expect((await stack.tasks()).body.tasks).toEqual([]);
  },
);
