// テスト用: frontend/index.html を happy-dom に読み込む（スクリプトは実行しない）。
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

export function createDocument() {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  window.document.write(html);
  return { window, document: window.document };
}

export const TASK = Object.freeze({
  id: "00000000-0000-4000-8000-000000000001",
  title: "牛乳を買う",
  completed: false,
  createdAt: "2026-10-01T09:00:00.000Z",
});

export const task = (n, overrides = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  title: `タスク${n}`,
  completed: false,
  createdAt: `2026-10-01T09:00:0${n}.000Z`,
  ...overrides,
});
