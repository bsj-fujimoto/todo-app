// 画面状態（docs/03-test-spec.md §9）: TC-055（データ破損）、TC-056（初期）、TC-057（読み込み中）、TC-058（一覧取得失敗）。
import { test, expect } from "../fixtures/stack.js";
import { DS002, DS002_TITLES } from "../fixtures/data.js";
import { MESSAGE } from "../fixtures/todo-app.js";

/** 一覧取得（GET）の応答を、release() が呼ばれるまで保留する（DS-012 の遅延を、固定時間ではなく条件で再現する）。 */
async function holdListResponse(page) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let hits = 0;
  await page.route("**/api/v1/tasks", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    hits += 1;
    await gate;
    return route.fallback();
  });
  return { release, hits: () => hits };
}

test(
  "[TC-055] 保存データが壊れていると、メッセージを出して操作を停止し、DB ファイルを上書きしない",
  { tag: ["@resilience"] },
  async ({ app, stack }) => {
    await stack.seed(DS002);
    await stack.corruptDb();
    const shaBefore = await stack.dbSha256();
    stack.clearRequests();

    await app.open({ ready: false });

    await expect(app.saveError).toHaveText(MESSAGE.dataCorrupt);
    await expect(app.emptyMessage).toHaveCount(0);
    await expect(app.rows).toHaveCount(0);
    await expect(app.input).toBeDisabled();
    await expect(app.addButton).toBeDisabled();

    // 操作できないこと（無効なボタンのクリックは何も起こさない）
    await app.addButton.click({ force: true });
    await expect(app.rows).toHaveCount(0);

    await app.page.reload();
    await expect(app.saveError).toHaveText(MESSAGE.dataCorrupt);
    await expect(app.emptyMessage).toHaveCount(0);
    await expect(app.input).toBeDisabled();

    expect(stack.calls("GET").map((c) => c.status)).toEqual([500, 500]);
    expect(stack.calls("GET")[0].responseBody.error.code).toBe("DATA_CORRUPT");
    expect(stack.calls("POST").filter((c) => c.status === 201)).toEqual([]);
    expect(await stack.dbSha256()).toBe(shaBefore);
  },
);

test(
  "[TC-056] 初回起動（空の DB）は見出し・入力欄・追加ボタンと「タスクはありません」を表示する",
  { tag: ["@smoke", "@cross-browser"] },
  async ({ app, stack, page }) => {
    await app.open();

    await expect(app.heading).toBeVisible();
    await expect(page).toHaveTitle("My TODO");
    await expect(app.input).toBeVisible();
    await expect(app.input).toHaveAttribute("placeholder", "タスクを入力（100文字まで）");
    await expect(app.input).toHaveValue("");
    await expect(page.getByLabel("タスク名")).toHaveCount(1);
    await expect(app.addButton).toBeVisible();
    await expect(app.emptyMessage).toBeVisible();
    await expect(app.rows).toHaveCount(0);
    await expect(app.saveError).toHaveText("");
    await expect(app.inputError).toHaveText("");

    const [list] = stack.calls("GET");
    expect([list.status, list.responseBody]).toEqual([200, { tasks: [] }]);
  },
);

test("[TC-057] 一覧の取得が終わるまで「読み込み中…」を出し、「タスクはありません」は出さず、取得後に一覧を表示する", async ({
  app,
  stack,
  page,
}) => {
  await stack.seed(DS002);
  const list = await holdListResponse(page);

  await page.goto("/");
  await expect.poll(list.hits).toBe(1); // 取得を開始している（応答は保留中）

  // 取得前（UNK-005 で確定）: 0 件と誤認させず、「読み込み中…」を出し、入力・追加は無効
  await expect(app.emptyMessage).toHaveCount(0);
  await expect(app.rows).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("読み込み中…");
  await expect(app.input).toBeDisabled();
  await expect(app.addButton).toBeDisabled();

  list.release();
  await app.expectTitles(DS002_TITLES);
  await expect(page.getByRole("status")).toHaveCount(0); // 読み込み中の表示は消える（空の status は非表示）
  await expect(app.input).toBeEnabled();
  await expect(app.emptyMessage).toHaveCount(0);
  expect(stack.calls("GET").map((c) => c.status)).toEqual([200]);
  expect(await stack.db()).toEqual(DS002);
});

test(
  "[TC-058] 一覧の取得に失敗したときは 0 件と誤認させず、エラーを表示し、再読込で回復する",
  { tag: ["@resilience"] },
  async ({ app, stack, page }) => {
    await stack.seed(DS002);
    await page.route("**/api/v1/tasks", (route) => route.abort("connectionfailed"));

    await app.open({ ready: false });

    await expect(app.saveError).toHaveText(MESSAGE.storageFailure);
    await expect(app.emptyMessage).toHaveCount(0);
    await expect(app.rows).toHaveCount(0);
    await expect(app.input).toBeDisabled();
    await expect(app.addButton).toBeDisabled();
    await expect(page.getByRole("button", { name: "再読み込み" })).toBeVisible();

    await page.unroute("**/api/v1/tasks");
    await page.reload();

    await app.expectTitles(DS002_TITLES);
    await expect(app.saveError).toHaveText("");
    expect(await stack.db()).toEqual(DS002);
  },
);

test(
  "[TC-058] 取得失敗のあと「再読み込み」ボタンで一覧が表示され、入力・追加が有効になる",
  { tag: ["@resilience"] },
  async ({ app, stack, page }) => {
    await stack.seed(DS002);
    await page.route("**/api/v1/tasks", (route) => route.abort("connectionfailed"));
    await app.open({ ready: false });
    await expect(app.saveError).toHaveText(MESSAGE.storageFailure);
    await expect(app.input).toBeDisabled();

    await page.unroute("**/api/v1/tasks");
    await page.getByRole("button", { name: "再読み込み" }).click();

    await app.expectTitles(DS002_TITLES);
    await expect(app.saveError).toHaveText("");
    await expect(app.input).toBeEnabled();
  },
);
