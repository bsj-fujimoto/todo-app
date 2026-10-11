// 外形監視（synthetic）のブラウザジャーニー。monitoring/monitors.yaml の MON-007〜010 に対応する（タイトルの [MON-xxx] で grep される）。
// 方針: 認証なし・合成データのみ（個人情報なし）。ジャーニーが作ったタスクは UI で削除し、afterEach で API からも必ず削除する。
// これは E2E テスト（e2e/ の他のファイル）とは別物で、本番相当の環境に対して定期実行する「監視」。
//
// 操作の取り方（ラベル・ロール・アクセシブルネーム）は e2e/fixtures/todo-app.js の TodoApp と揃えている。
// そのまま import しないのは、e2e の @playwright/test と別のコピーが読み込まれて test() の登録が壊れるため（e2e/synthetic は独立した package）。
// 製品の画面の振る舞いが変わったら（例: PR #12「チェックは API 成功後にだけ反転する」）、この定義も見直す（monitoring/README.md の運用規則）。
import { expect, test } from "@playwright/test";

const RUN_ID = process.env.SYNTHETIC_RUN_ID || String(Date.now());
const PREFIX = `synthetic-${RUN_ID}`;
const created = [];

const title = (monitorId) => `${PREFIX}-${monitorId}`;
const row = (page, text) => page.getByRole("listitem").filter({ hasText: text });
// チェックボックス: アクセシブルネームは「「<タイトル>」を完了にする」（e2e の TodoApp.checkbox と同じ）
const checkboxOf = (page, text) =>
  page.getByRole("checkbox", { name: `「${text}」を完了にする`, exact: true });

// チェックの切替は「API 成功後にだけ反転する」（通信中は反転せず aria-busy）。check() / uncheck() はクリック直後に状態変化を
// 検証して失敗するので、click() のあと、期待する状態になるまで自動で待つ（行の aria-busy の解除も待つ）。
async function setChecked(page, text, checked) {
  await checkboxOf(page, text).click();
  if (checked) await expect(checkboxOf(page, text)).toBeChecked();
  else await expect(checkboxOf(page, text)).not.toBeChecked();
  await expect(row(page, text)).toHaveAttribute("aria-busy", "false");
}

async function openApp(page) {
  const res = await page.goto("/");
  expect(res.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "My TODO" })).toBeVisible();
}

async function addTask(page, text) {
  await page.getByRole("textbox").first().fill(text);
  await page.getByRole("button", { name: "追加" }).click();
  await expect(row(page, text)).toBeVisible();
  created.push(text);
}

// 取りこぼし防止: このジャーニーの接頭辞を持つタスクを API から全部消す（404 は削除済みとして許容）
test.afterEach(async ({ request }) => {
  const res = await request.get("/api/v1/tasks");
  if (!res.ok()) return;
  const { tasks } = await res.json();
  for (const t of tasks.filter((x) => x.title.startsWith(PREFIX))) {
    await request.delete(`/api/v1/tasks/${t.id}`);
  }
  created.length = 0;
});

test("[MON-007] J-01 追加すると一覧に出て、再読込しても残る", async ({ page }) => {
  const text = title("MON-007");
  const t0 = Date.now();
  await openApp(page);
  await addTask(page, text);
  await page.reload();
  await expect(row(page, text)).toBeVisible();
  expect(Date.now() - t0, "画面表示から追加・再読込の確認までが 10 秒以内").toBeLessThan(10000);
  await row(page, text).getByRole("button", { name: /削除/ }).click();
  await expect(row(page, text)).toHaveCount(0);
});

test("[MON-008] J-02 チェックすると完了になり、再読込しても保持される", async ({ page }) => {
  const text = title("MON-008");
  await openApp(page);
  await addTask(page, text);
  await setChecked(page, text, true);
  await page.reload();
  await expect(checkboxOf(page, text)).toBeChecked();
  await setChecked(page, text, false);
  await row(page, text).getByRole("button", { name: /削除/ }).click();
  await expect(row(page, text)).toHaveCount(0);
});

test("[MON-009] J-03 削除ボタンで消え、再読込しても表示されない", async ({ page }) => {
  const text = title("MON-009");
  await openApp(page);
  await addTask(page, text);
  await row(page, text).getByRole("button", { name: /削除/ }).click();
  await expect(row(page, text)).toHaveCount(0);
  await page.reload();
  await expect(row(page, text)).toHaveCount(0);
});

test("[MON-010] J-04 空入力はエラーで弾かれ、件数が変わらない", async ({ page }) => {
  await openApp(page);
  const before = await page.getByRole("listitem").count();
  await page.getByRole("textbox").first().fill("   ");
  await page.getByRole("button", { name: "追加" }).click();
  await expect(page.getByText("タスク名を入力してください")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(before);
});
