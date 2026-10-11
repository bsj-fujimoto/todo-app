// 画面状態の純粋な遷移（DOM・通信に依存しない）。
// phase: loading（取得中）/ ready（一覧 or 0 件）/ load-error（取得失敗）/ corrupt（DATA_CORRUPT。操作停止）
import { isTitleErrorCode } from "./messages.js";

export function initialState() {
  return {
    phase: "loading",
    tasks: [],
    submitting: false,
    busyIds: [],
    inputError: null, // TITLE_* のコード（入力欄の直下に表示）
    topError: null, // STORAGE_FAILURE / DATA_CORRUPT（画面上部に表示）
  };
}

/** 失敗応答を画面上の扱いへ分類する。 */
export function classifyFailure(failure) {
  if (failure.code === "DATA_CORRUPT") return { kind: "corrupt" };
  if (isTitleErrorCode(failure.code)) return { kind: "input", code: failure.code };
  return { kind: "save" };
}

const without = (ids, id) => ids.filter((x) => x !== id);

function applyFailure(state, failure) {
  const next = { ...state, submitting: false };
  const result = classifyFailure(failure);
  if (result.kind === "corrupt") return { ...next, phase: "corrupt", tasks: [], topError: "DATA_CORRUPT" };
  if (result.kind === "input") return { ...next, inputError: result.code };
  return { ...next, topError: "STORAGE_FAILURE" };
}

const handlers = {
  "load-started": (s) => ({ ...s, phase: "loading", topError: null }),
  "load-succeeded": (s, a) => ({ ...s, phase: "ready", tasks: a.tasks, topError: null }),
  "load-failed": (s, a) =>
    a.failure.code === "DATA_CORRUPT"
      ? applyFailure(s, a.failure)
      : { ...s, phase: "load-error", tasks: [], topError: "STORAGE_FAILURE" },
  "input-edited": (s) => ({ ...s, inputError: null }),
  "input-invalid": (s, a) => ({ ...s, inputError: a.code }),
  "submit-started": (s) => ({ ...s, submitting: true, inputError: null, topError: null }),
  "task-added": (s, a) => ({ ...s, submitting: false, tasks: [a.task, ...s.tasks] }),
  "submit-failed": (s, a) => applyFailure(s, a.failure),
  "op-started": (s, a) => ({ ...s, busyIds: [...s.busyIds, a.id], topError: null }),
  "task-updated": (s, a) => ({
    ...s,
    busyIds: without(s.busyIds, a.task.id),
    tasks: s.tasks.map((t) => (t.id === a.task.id ? a.task : t)),
  }),
  "task-removed": (s, a) => ({
    ...s,
    busyIds: without(s.busyIds, a.id),
    tasks: s.tasks.filter((t) => t.id !== a.id),
  }),
  "op-failed": (s, a) => applyFailure({ ...s, busyIds: without(s.busyIds, a.id) }, a.failure),
};

/** @returns 新しい状態（引数は変更しない） */
export function reduce(state, action) {
  const handler = handlers[action.type];
  return handler ? handler(state, action) : state;
}

/** 入力・追加ボタンを使えるか。ready 以外（取得中・取得失敗・破損）は停止する。 */
export function controlsEnabled(state) {
  return state.phase === "ready";
}
