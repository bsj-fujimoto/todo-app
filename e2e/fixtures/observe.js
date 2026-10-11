// 各テストの終了時に「実際に観察した値」を自動で残す fixture（全テストに効く auto fixture）。
//   画面: 一覧の行（表示テキスト・チェック状態）・入力欄の値・表示中のエラー文言・フォーカス中の要素
//   通信: 観測した API 呼び出し（method path → status）の列
//   計測値・補足: テストが observe(label, value) で残したもの
// 書き出し先: e2e/test-results/observations/<TC-ID>.<project>.json と、test.info().annotations（type: observed）。
// 期待結果の転記はしない。サイズは小さく保つ（行数・文字数・呼び出し数の上限は backend/test-support/observe.js の LIMITS）。
/* global document -- page.evaluate() のコールバックはブラウザ内で実行される */
import { test as base } from "@playwright/test";
import {
  LIMITS,
  buildEntry,
  clip,
  createObservations,
  observationsDir,
  writeEntry,
} from "../../backend/test-support/index.js";

const CAPTURE_TIMEOUT_MS = 3000;

/** ブラウザ内で画面の状態を読む（テキスト・チェック状態のみ。利用者データは合成データ）。 */
function readScreen(limits) {
  const clipText = (value) => {
    const chars = [...(value ?? "")];
    return chars.length > limits.titleChars
      ? `${chars.slice(0, limits.titleChars).join("")}…(${chars.length}文字)`
      : chars.join("");
  };
  const message = (selector) => clipText(document.querySelector(selector)?.textContent ?? "");
  const items = [...document.querySelectorAll("li.task")];
  const focused = document.activeElement;
  return {
    row_count: items.length,
    rows: items.slice(0, limits.rows).map((li) => ({
      text: clipText(li.querySelector(".task-title")?.textContent),
      checked: Boolean(li.querySelector(".task-check")?.checked),
      busy: li.getAttribute("aria-busy") === "true",
    })),
    rows_omitted: Math.max(0, items.length - limits.rows),
    input_value: clipText(document.querySelector("#title-input")?.value),
    input_disabled: Boolean(document.querySelector("#title-input")?.disabled),
    save_error: message("#save-error"),
    input_error: message("#input-error"),
    list_message: message("#list-message"),
    focus: focused ? clipText(focused.id || focused.getAttribute("aria-label") || focused.tagName) : null,
  };
}

async function captureScreen(page) {
  if (page.isClosed() || page.url() === "about:blank") return null;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS));
  try {
    return await Promise.race([page.evaluate(readScreen, LIMITS), timeout]);
  } catch {
    return null;
  }
}

/** ページが観測した /api への応答（stack を使わないテスト用）。 */
function trackApiCalls(page, calls) {
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) return;
    calls.push({
      method: response.request().method(),
      path: `${url.pathname}${url.search}`,
      status: response.status(),
    });
  });
}

const asCall = (c) => ({
  method: c.method,
  path: c.path,
  status: c.status,
  request: c.requestBody,
  response: c.responseBody,
});

function annotationText(screen, calls) {
  const rows = screen ? `一覧 ${screen.row_count} 行` : "画面なし";
  const errors = [screen?.save_error, screen?.input_error].filter(Boolean).join(" / ") || "エラー表示なし";
  return clip(`${rows}、${errors}、API ${calls.length} 件`, 200);
}

function environmentOf({ page, testInfo }) {
  const browser = page.context().browser();
  return {
    project: testInfo.project.name,
    browser: browser ? `${browser.browserType().name()} ${browser.version()}` : null,
    viewport: page.viewportSize(),
    locale: testInfo.project.use.locale ?? null,
  };
}

/** auto fixture と observe(label, value)。stack.js の stack fixture は observed.source を設定して通信の記録を渡す。 */
export const observeFixtures = {
  // page に依存しない（page → baseURL → stack → observed の循環を避ける）。ページの通信記録は observation が足す
  // eslint-disable-next-line no-empty-pattern
  observed: async ({}, use, testInfo) => {
    const layer = testInfo.project.name === "compose" ? "compose" : "e2e";
    const obs = createObservations({ layer, component: "e2e", project: testInfo.project.name });
    const observed = { obs, pageCalls: [], source: null };
    await use(observed);
  },
  observe: async ({ observed }, use, testInfo) => {
    await use((label, value) => {
      observed.obs.note(label, value);
      testInfo.annotations.push({ type: "observed", description: clip(`${label}: ${value}`, 200) });
    });
  },
  observation: [
    async ({ observed, page }, use, testInfo) => {
      trackApiCalls(page, observed.pageCalls);
      await use();
      const screen = await captureScreen(page);
      const calls = observed.source ? observed.source().map(asCall) : observed.pageCalls;
      for (const call of calls) observed.obs.call(call);
      testInfo.annotations.push({ type: "observed", description: annotationText(screen, calls) });
      const entry = buildEntry({
        obs: observed.obs,
        title: testInfo.title,
        outcome: testInfo.status ?? "unknown",
        durationMs: Math.round(testInfo.duration),
        extra: { screen, environment: environmentOf({ page, testInfo }) },
      });
      writeEntry({
        dir: observationsDir("e2e"),
        entry,
        nameFor: (tcId) => `${tcId}.${testInfo.project.name}`,
      });
    },
    { auto: true },
  ],
};

export const test = base.extend(observeFixtures);
