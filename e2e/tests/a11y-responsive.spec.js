// モバイル幅・キーボード操作・アクセシビリティ: TC-067（360px・タッチ。project chromium-mobile-360）、TC-068（キーボードのみ）、TC-069（ラベルと axe-core）。
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../fixtures/stack.js";
import { DS002, DS002_TITLES } from "../fixtures/data.js";

test(
  "[TC-067] 幅 360px のタッチ操作で、横スクロールなしに追加・完了・削除ができる",
  { tag: ["@compat", "@mobile"] },
  async ({ app, stack, page }) => {
    await stack.seed(DS002);
    const long = "a".repeat(100); // 空白のない 100 文字も折り返される
    const insideViewport = () =>
      app.expectInsideViewport(page.locator("#title-input, #add-button, .task-check, .task .delete"));
    const checkLayout = async () => {
      await app.expectNoHorizontalScroll();
      await insideViewport();
    };

    await app.open();
    expect(page.viewportSize().width).toBe(360);
    await checkLayout();

    await app.input.fill(long);
    await app.addButton.tap();
    await app.expectTitles([long, ...DS002_TITLES]);
    await checkLayout();

    await app.checkbox(long).tap();
    await expect(app.checkbox(long)).toBeChecked();
    await app.expectStrikethrough(long, true);
    await checkLayout();

    await app.deleteButton("牛乳を買う").tap();
    await app.expectTitles([long, "打ち合わせの準備をする", "仕様書をレビューする"]);
    await checkLayout();

    expect(stack.calls("POST").map((c) => c.status)).toEqual([201]);
    expect(stack.calls("PATCH").map((c) => c.status)).toEqual([200]);
    expect(stack.calls("DELETE").map((c) => c.status)).toEqual([204]);
    expect((await stack.tasks()).body.tasks.map((t) => [t.title, t.completed])).toEqual([
      [long, true],
      ["打ち合わせの準備をする", true],
      ["仕様書をレビューする", false],
    ]);
  },
);

/** いまフォーカスのある要素の名前と、フォーカス表示（outline または box-shadow）の有無。 */
const focusedElement = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return {
      name: el.getAttribute("aria-label") ?? el.textContent.trim(),
      visibleFocus: style.outlineStyle !== "none" || style.boxShadow !== "none",
    };
  });

test(
  "[TC-068] キーボードだけで追加・完了・削除ができ、フォーカス順が視覚順と一致し、フォーカスが見える",
  { tag: ["@a11y"] },
  async ({ app, stack, page }) => {
    await stack.seed(DS002);
    await app.open();

    // 1. Tab で入力欄へ。入力して Enter
    await page.keyboard.press("Tab");
    await expect(app.input).toBeFocused();
    expect((await focusedElement(page)).visibleFocus).toBe(true);
    await page.keyboard.type("資料を印刷する");
    await page.keyboard.press("Enter");
    const titles = ["資料を印刷する", ...DS002_TITLES];
    await app.expectTitles(titles);
    await expect(app.input).toHaveValue("");

    // 2. フォーカス順: 追加ボタン → 各行の チェックボックス → 削除ボタン（上から下）
    const expected = ["追加", ...titles.flatMap((t) => [`「${t}」を完了にする`, `「${t}」を削除`])];
    const order = [];
    for (let i = 0; i < expected.length; i += 1) {
      await page.keyboard.press("Tab");
      order.push(await focusedElement(page));
    }
    expect(order.map((o) => o.name)).toEqual(expected);
    expect(order.every((o) => o.visibleFocus)).toBe(true);

    // 3. 先頭行のチェックボックスにフォーカスして Space
    await app.checkbox("資料を印刷する").focus();
    await page.keyboard.press("Space");
    await expect(app.checkbox("資料を印刷する")).toBeChecked();
    await app.expectStrikethrough("資料を印刷する", true);
    await expect(app.checkbox("資料を印刷する")).toBeFocused(); // 操作後もフォーカスが保たれる
    expect((await focusedElement(page)).visibleFocus).toBe(true);

    // 4. 先頭行の削除ボタンにフォーカスして Enter
    await app.deleteButton("資料を印刷する").focus();
    await page.keyboard.press("Enter");
    await app.expectTitles(DS002_TITLES);
    await expect(app.checkbox("打ち合わせの準備をする")).toBeFocused(); // 行が消えてもフォーカスを見失わない

    expect(stack.calls("POST").map((c) => c.status)).toEqual([201]);
    expect(stack.calls("PATCH").map((c) => c.status)).toEqual([200]);
    expect(stack.calls("DELETE").map((c) => c.status)).toEqual([204]);
    expect((await stack.tasks()).body.tasks.map((t) => t.title)).toEqual(DS002_TITLES);
  },
);

test(
  "[TC-069] 入力欄にラベル、各行の操作にタイトルを含む名前があり、axe-core の重大な違反がない",
  { tag: ["@a11y"] },
  async ({ app, stack, page }) => {
    await stack.seed([
      ...DS002,
      { ...DS002[0], id: "00000000-0000-4000-8000-000000000004", createdAt: "2026-10-01T09:00:03.000Z" },
    ]);
    await app.open();
    await expect(app.rows).toHaveCount(4); // 同名タスク「牛乳を買う」が 2 行

    // 入力欄はラベル「タスク名」で 1 要素だけ取得できる
    await expect(page.getByLabel("タスク名")).toHaveCount(1);
    await expect(page.getByLabel("タスク名")).toHaveAttribute("id", "title-input");

    // 各行のチェックボックスと削除ボタンの名前にその行のタイトルが含まれる
    const titles = ["牛乳を買う", "打ち合わせの準備をする", "仕様書をレビューする", "牛乳を買う"];
    const rows = await app.rows.all();
    for (const [index, row] of rows.entries()) {
      await expect(row.getByRole("checkbox")).toHaveAccessibleName(new RegExp(titles[index]));
      await expect(row.getByRole("button")).toHaveAccessibleName(new RegExp(titles[index]));
    }

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]); // impact を問わず 0 件を保つ

    // 検査中に backend へ届いたのは一覧取得（GET /api/v1/tasks）の 1 回だけ
    expect(stack.calls().map((c) => `${c.method} ${c.path} ${c.status}`)).toEqual(["GET /api/v1/tasks 200"]);
  },
);

test(
  "[TC-069] エラー表示中・保存失敗表示中も axe-core の違反がない",
  { tag: ["@a11y"] },
  async ({ app, page }) => {
    await app.open();
    await app.addButton.click();
    await expect(app.inputError).toHaveText("タスク名を入力してください");
    let results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);

    await page.route("**/api/v1/tasks", (route) =>
      route.request().method() === "POST" ? route.abort("connectionfailed") : route.fallback(),
    );
    await app.add("資料を印刷する");
    await expect(app.saveError).toHaveText("保存できませんでした。もう一度お試しください");
    results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  },
);
