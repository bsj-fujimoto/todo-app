// 画面の振る舞い（イベント → API → 状態遷移 → 描画）。通信と DOM は注入された api・view を介して扱う。
// 追加・完了切替・削除は API の成功を確認してから画面へ反映する（楽観更新しない）。
import { initialState, reduce } from "./state.js";
import { validateTitle } from "./validation.js";

/** 状態を 1 か所で持ち、遷移のたびに描画する。 */
function createStore(view) {
  let state = initialState();
  return {
    get: () => state,
    dispatch(action) {
      state = reduce(state, action);
      view.render(state);
    },
  };
}

function createLoader({ api, store }) {
  return async function load() {
    store.dispatch({ type: "load-started" });
    const result = await api.listTasks();
    store.dispatch(
      result.ok ? { type: "load-succeeded", tasks: result.data } : { type: "load-failed", failure: result },
    );
  };
}

function createSubmitter({ api, view, store }) {
  return async function submit() {
    const { phase, submitting } = store.get();
    if (phase !== "ready" || submitting) return;
    const submitted = view.getInputValue();
    const checked = validateTitle(submitted);
    if (!checked.ok) {
      store.dispatch({ type: "input-invalid", code: checked.code });
      view.focusInput();
      return;
    }
    store.dispatch({ type: "submit-started" });
    const result = await api.createTask(checked.title);
    if (!result.ok) {
      store.dispatch({ type: "submit-failed", failure: result });
      return;
    }
    store.dispatch({ type: "task-added", task: result.data });
    // 送信中に利用者が打ち直していたら、その入力は消さない（Issue #6）
    if (view.getInputValue() === submitted) view.clearInput();
    view.focusInput();
  };
}

/** 行に対する操作（完了切替・削除）の共通手順。通信中の行への重複操作は無視する。 */
function createOperator({ store }) {
  return async function operate(id, call, onSuccess) {
    const { phase, busyIds } = store.get();
    if (phase !== "ready" || busyIds.includes(id)) return;
    store.dispatch({ type: "op-started", id });
    const result = await call();
    store.dispatch(result.ok ? onSuccess(result) : { type: "op-failed", id, failure: result });
  };
}

/**
 * @param {{ api: ReturnType<typeof import("./api-client.js").createApiClient>, view: ReturnType<typeof import("./view.js").createView> }} deps
 */
export function createApp({ api, view }) {
  const store = createStore(view);
  const load = createLoader({ api, store });
  const submit = createSubmitter({ api, view, store });
  const operate = createOperator({ store });

  return {
    start: load,
    getState: store.get,
    handlers: {
      onSubmit: submit,
      onInput: () => store.dispatch({ type: "input-edited" }),
      onRetry: load,
      onToggle: (id, completed) =>
        operate(
          id,
          () => api.updateTask(id, completed),
          (result) => ({ type: "task-updated", task: result.data }),
        ),
      onDelete: (id) =>
        operate(
          id,
          () => api.deleteTask(id),
          () => ({ type: "task-removed", id }),
        ),
    },
  };
}
