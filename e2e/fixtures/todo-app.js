// 画面の操作・取得のヘルパー（ラベル・ロール・アクセシブルネームで要素を引く）。
/* global document, window -- page.evaluate() のコールバックはブラウザ内で実行される */
import { expect } from "@playwright/test";

export const MESSAGE = {
  empty: "タスクはありません",
  storageFailure: "保存できませんでした。もう一度お試しください",
  dataCorrupt: "保存データを読み込めませんでした",
  titleRequired: "タスク名を入力してください",
  titleTooLong: "タスク名は100文字以内で入力してください",
  titleMultiline: "タスク名は1行で入力してください",
};

export class TodoApp {
  constructor(page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: "My TODO" });
    this.input = page.getByLabel("タスク名", { exact: true });
    this.addButton = page.getByRole("button", { name: "追加", exact: true });
    this.saveError = page.locator("#save-error");
    this.inputError = page.locator("#input-error");
    this.rows = page.locator("li.task");
    this.titles = page.locator("li.task .task-title");
    this.emptyMessage = page.getByText(MESSAGE.empty);
    this.listMessage = page.locator("#list-message");
  }

  /** 画面を開き、既定では一覧の取得が終わって入力できる（ready）まで待つ。 */
  async open({ ready = true } = {}) {
    await this.page.goto("/");
    if (ready) await expect(this.input).toBeEnabled();
  }

  title(text) {
    return this.page.locator("li.task .task-title", { hasText: new RegExp(`^${escapeRegExp(text)}$`) });
  }

  row(text) {
    const title = this.page.locator(".task-title", { hasText: new RegExp(`^${escapeRegExp(text)}$`) });
    return this.page.locator("li.task").filter({ has: title });
  }

  checkbox(text) {
    return this.page.getByRole("checkbox", { name: `「${text}」を完了にする`, exact: true });
  }

  deleteButton(text) {
    return this.page.getByRole("button", { name: `「${text}」を削除`, exact: true });
  }

  /** 入力して追加する。via: "button"（追加ボタン）/ "enter"（Enter キー） */
  async add(text, via = "button") {
    await this.input.fill(text);
    if (via === "enter") await this.input.press("Enter");
    else await this.addButton.click();
  }

  async expectTitles(expected) {
    await expect(this.titles).toHaveText(expected);
  }

  async expectNoErrors() {
    await expect(this.saveError).toHaveText("");
    await expect(this.inputError).toHaveText("");
  }

  async expectStrikethrough(text, struck) {
    await expect(this.title(text)).toHaveCSS("text-decoration-line", struck ? "line-through" : "none");
  }

  /** 横スクロールが出ていない（documentElement.scrollWidth がビューポート幅以下）。 */
  async expectNoHorizontalScroll() {
    const { scrollWidth, innerWidth } = await this.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  }

  /** 要素の境界ボックスがビューポート内（x >= 0、右端 <= 幅）に収まる。 */
  async expectInsideViewport(locator) {
    const width = this.page.viewportSize().width;
    for (const element of await locator.all()) {
      const box = await element.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
