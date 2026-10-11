// frontend unit テストの観察（実際に見た画面・状態・入力→結果）。import するだけで各テストの終了時に書き出される。
import { observeEachTest } from "./observe-node-test.js";
import { describeText, describeValidation } from "./observe.js";

export const observations = observeEachTest({ layer: "unit", component: "frontend" });
/** 入力と、検証関数が実際に返した結果を 1 行残す。 */
export const observeValidation = (input, result) =>
  observations.row(describeText(input), describeValidation(result));
/** 同じ入力を frontend と backend の検証関数へ流した結果を 1 行残す。 */
export const observePair = (input, front, back) =>
  observations.row(
    describeText(input),
    `frontend: ${describeValidation(front)} / backend: ${describeValidation(back)}`,
  );
export const observe = (label, value) => observations.note(label, value);

const shown = (text) => (text === "" || text === null || text === undefined ? "なし" : JSON.stringify(text));

/** reduce の結果（画面状態）の要約。実際に得られた phase・件数・エラー・通信中の行を残す。 */
export const describeState = (state) =>
  `phase=${state.phase} 件数=${state.tasks.length} 上部エラー=${shown(state.topError)} 入力エラー=${shown(state.inputError)} 送信中=${state.submitting} 通信中の行=${state.busyIds.length}`;
export const observeState = (state) => observations.note("状態", describeState(state));

/** happy-dom の画面（app + view の結合テスト）の要約。一覧・入力欄・エラー文言・追加ボタンの状態。 */
export function describeScreen(ui) {
  const rows = [...ui.document.querySelectorAll("li.task")].map((li) => {
    const title = li.querySelector(".task-title").textContent;
    const checked = li.querySelector(".task-check").checked ? "済" : "未";
    return `${title}(${checked}${li.getAttribute("aria-busy") === "true" ? "・通信中" : ""})`;
  });
  return [
    `一覧 ${rows.length} 行 [${rows.slice(0, 10).join(", ")}]`,
    `入力欄=${shown(ui.input.value)}`,
    `入力エラー=${shown(ui.inputError.textContent)}`,
    `保存エラー=${shown(ui.saveError.textContent)}`,
    `一覧メッセージ=${shown(ui.message.textContent)}`,
    `追加ボタン=${ui.add.disabled ? "無効" : "有効"}`,
  ].join("、");
}

/** 終了時点の画面と、偽 API が受けた呼び出しの列を観察として残す。 */
export function observeScreenAtEnd(ui) {
  observations.onFinish(() => {
    observations.set("画面", describeScreen(ui));
    const calls = ui.calls.map(
      ([name, ...args]) => `${name}(${args.map((a) => JSON.stringify(a)).join(",")})`,
    );
    observations.set("API 呼び出し", calls.join(" → ") || "なし");
  });
}
