// 画面の振る舞い（イベント → API → 状態遷移 → 描画）。通信と DOM は注入された api・view を介して扱う。
// 追加・完了切替・削除は API の成功を確認してから画面へ反映する（楽観更新しない）。
import { initialState, reduce } from "./state.js";
import { validateTitle } from "./validation.js";

/**
 * @param {{ api: ReturnType<typeof import("./api-client.js").createApiClient>, view: ReturnType<typeof import("./view.js").createView> }} deps
 */
export function createApp({ api, view }) {
  let state = initialState();

  function dispatch(action) {
    state = reduce(state, action);
    view.render(state);
  }

  async function load() {
    dispatch({ type: "load-started" });
    const result = await api.listTasks();
    dispatch(
      result.ok ? { type: "load-succeeded", tasks: result.data } : { type: "load-failed", failure: result },
    );
  }

  async function submit() {
    if (state.phase !== "ready" || state.submitting) return;
    const submitted = view.getInputValue();
    const checked = validateTitle(submitted);
    if (!checked.ok) {
      dispatch({ type: "input-invalid", code: checked.code });
      view.focusInput();
      return;
    }
    dispatch({ type: "submit-started" });
    const result = await api.createTask(checked.title);
    if (!result.ok) {
      dispatch({ type: "submit-failed", failure: result });
      return;
    }
    dispatch({ type: "task-added", task: result.data });
    // 送信中に利用者が打ち直していたら、その入力は消さない（Issue #6）
    if (view.getInputValue() === submitted) view.clearInput();
    view.focusInput();
  }

  /** 行に対する操作（完了切替・削除）の共通手順。 */
  async function operate(id, call, onSuccess) {
    if (state.phase !== "ready" || state.busyIds.includes(id)) return;
    dispatch({ type: "op-started", id });
    const result = await call();
    dispatch(result.ok ? onSuccess(result) : { type: "op-failed", id, failure: result });
  }

  return {
    start: load,
    getState: () => state,
    handlers: {
      onSubmit: submit,
      onInput: () => dispatch({ type: "input-edited" }),
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
