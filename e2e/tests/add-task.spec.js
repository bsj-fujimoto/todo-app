// タスク追加: ペアワイズ（TC-002〜TC-007。docs/03-test-spec.md §8.1 の表の行をパラメータ化）と入力エラー（TC-016〜TC-020）。
import { test, expect } from "../fixtures/stack.js";
import { DS002, DS002_TITLES, ISO_UTC, UUID_V4 } from "../fixtures/data.js";

const EMOJI_100 = "😀".repeat(100);

// §8.1 ペアワイズ表。tc は対応するケース、existing は既存タスク件数（0 / 3）、expected は保存・表示されるタイトル
const PAIRWISE = [
  { row: "PW-01", tc: "TC-002", via: "enter", raw: "買い物", expected: "買い物", width: 360, existing: 0 },
  { row: "PW-02", tc: "TC-003", via: "button", raw: "買い物", expected: "買い物", width: 1280, existing: 3 },
  {
    row: "PW-03",
    tc: "TC-004",
    via: "enter",
    raw: "  買い物  ",
    expected: "買い物",
    width: 1280,
    existing: 3,
  },
  {
    row: "PW-04",
    tc: "TC-005",
    via: "button",
    raw: "  買い物  ",
    expected: "買い物",
    width: 360,
    existing: 0,
  },
  { row: "PW-05", tc: "TC-006", via: "enter", raw: EMOJI_100, expected: EMOJI_100, width: 360, existing: 3 },
  {
    row: "PW-06",
    tc: "TC-007",
    via: "button",
    raw: EMOJI_100,
    expected: EMOJI_100,
    width: 1280,
    existing: 0,
  },
];

for (const { row, tc, via, raw, expected, width, existing } of PAIRWISE) {
  const label = `${row} ${via === "enter" ? "Enter キー" : "追加ボタン"} / ${width}px / 既存 ${existing} 件`;
  test(`[${tc}] ペアワイズ ${label}`, { tag: ["@pairwise"] }, async ({ app, stack, page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 640 : 800 });
    if (existing > 0) await stack.seed(DS002);
    const before = existing > 0 ? DS002_TITLES : [];

    await app.open();
    if (existing === 0) await expect(app.emptyMessage).toBeVisible();
    await app.expectTitles(before);

    await app.add(raw, via);

    await app.expectTitles([expected, ...before]);
    await expect(app.emptyMessage).toHaveCount(0);
    await expect(app.input).toHaveValue("");
    await app.expectNoErrors();
    await expect(app.checkbox(expected)).not.toBeChecked();
    await app.expectStrikethrough(expected, false);
    await app.expectInsideViewport(page.locator("#title-input, #add-button, li.task:first-child"));
    if (width === 360) await app.expectNoHorizontalScroll();

    const posts = stack.calls("POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].status).toBe(201);
    expect(posts[0].responseBody).toMatchObject({ title: expected, completed: false });
    expect(posts[0].responseBody.id).toMatch(UUID_V4);
    expect(posts[0].responseBody.createdAt).toMatch(ISO_UTC);

    const { body } = await stack.tasks();
    expect(body.tasks).toHaveLength(existing + 1);
    expect(body.tasks[0]).toMatchObject({ title: expected, completed: false });
  });
}

test(
  "[TC-016] 空欄・空白のみは入力欄の直下にエラーを出し、追加しない",
  { tag: ["@boundary"] },
  async ({ app, stack, page }) => {
    await app.open();
    await expect(app.emptyMessage).toBeVisible();

    await app.addButton.click();
    await expect(app.inputError).toHaveText("タスク名を入力してください");

    await app.input.fill("   ");
    await app.input.press("Enter");
    await expect(app.inputError).toHaveText("タスク名を入力してください");

    // エラーは入力欄の直後の要素。画面上部の保存エラー領域は空のまま
    const nextId = await page.evaluate(() => document.getElementById("title-input").nextElementSibling.id);
    expect(nextId).toBe("input-error");
    await expect(app.input).toHaveAttribute("aria-invalid", "true");
    await expect(app.input).toHaveAccessibleDescription("タスク名を入力してください");
    await expect(app.saveError).toHaveText("");
    await expect(app.emptyMessage).toBeVisible();
    await expect(app.rows).toHaveCount(0);

    // 画面は検証して POST を送らない（送られた場合は 422 であること）
    expect(stack.calls("POST").filter((c) => c.status !== 422)).toEqual([]);
    expect((await stack.tasks()).body.tasks).toEqual([]);
  },
);

test("[TC-017] 101 文字は長さのエラーを出し、追加しない", { tag: ["@boundary"] }, async ({ app, stack }) => {
  await stack.seed(DS002);
  await app.open();

  await app.add("a".repeat(101));

  await expect(app.inputError).toHaveText("タスク名は100文字以内で入力してください");
  await app.expectTitles(DS002_TITLES);
  expect(stack.calls("POST").filter((c) => c.status !== 422)).toEqual([]);
  expect((await stack.tasks()).body.tasks).toHaveLength(3);
});

test("[TC-018] 100 文字ちょうどは追加できる", { tag: ["@boundary"] }, async ({ app, stack }) => {
  await stack.seed(DS002);
  await app.open();

  await app.add("a".repeat(100));

  await app.expectTitles(["a".repeat(100), ...DS002_TITLES]);
  await expect(app.input).toHaveValue("");
  await app.expectNoErrors();
  const posts = stack.calls("POST");
  expect(posts.map((c) => c.status)).toEqual([201]);
  expect([...posts[0].responseBody.title]).toHaveLength(100);
  expect((await stack.tasks()).body.tasks).toHaveLength(4);
});

test("[TC-019] エラー表示のあとに有効な入力で追加すると、エラーが消える", async ({ app, stack }) => {
  await app.open();
  await app.addButton.click();
  await expect(app.inputError).toHaveText("タスク名を入力してください");

  await app.add("牛乳を買う");

  await app.expectTitles(["牛乳を買う"]);
  await expect(app.inputError).toHaveText("");
  await expect(app.input).toHaveValue("");
  expect(stack.calls("POST").map((c) => c.status)).toEqual([201]);
  expect((await stack.tasks()).body.tasks.map((t) => [t.title, t.completed])).toEqual([
    ["牛乳を買う", false],
  ]);
});

test("[TC-020] 同じタイトルを 2 回追加すると別 ID の 2 件になる", async ({ app, stack }) => {
  await app.open();
  await app.add("会議");
  await app.expectTitles(["会議"]);
  await app.add("会議");
  await app.expectTitles(["会議", "会議"]);
  await app.expectNoErrors();
  await expect(app.checkbox("会議")).toHaveCount(2);

  const posts = stack.calls("POST");
  expect(posts.map((c) => c.status)).toEqual([201, 201]);
  expect(posts[0].responseBody.id).not.toBe(posts[1].responseBody.id);

  const { status, body } = await stack.tasks();
  expect(status).toBe(200);
  expect(body.tasks).toHaveLength(2);
  expect(new Set(body.tasks.map((t) => t.id)).size).toBe(2);
  expect(body.tasks.map((t) => t.title)).toEqual(["会議", "会議"]);
});
