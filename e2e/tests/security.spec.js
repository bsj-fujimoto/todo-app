// セキュリティ: TC-061（タイトルを HTML として解釈しない。dialog イベントを監視する。DS-005）。
import { test, expect } from "../fixtures/stack.js";
import { DS005_XSS } from "../fixtures/data.js";

test(
  "[TC-061] 悪意ある文字列はテキストのまま表示され、要素にも dialog にもならない",
  { tag: ["@security"] },
  async ({ app, stack, page }) => {
    const dialogs = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      dialog.dismiss();
    });
    await app.open();

    for (const title of DS005_XSS) await app.add(title);

    const reversed = [...DS005_XSS].reverse();
    const expectAllPlain = async () => {
      await app.expectTitles(reversed);
      await expect(page.locator("li.task img, li.task script, li.task svg, li.task b")).toHaveCount(0);
    };
    await expectAllPlain();
    await expect(app.title("&lt;b&gt;")).toHaveText("&lt;b&gt;"); // 「<b>」に変換されない

    await page.reload();
    await expectAllPlain();
    expect(dialogs).toEqual([]);

    expect(stack.calls("POST").map((c) => c.status)).toEqual([201, 201, 201, 201]);
    expect((await stack.tasks()).body.tasks.map((t) => t.title)).toEqual(reversed);
  },
);
