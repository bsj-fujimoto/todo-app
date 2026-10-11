// DOM 描画。タイトルは必ず textContent で設定し、HTML として解釈しない（仕様 §07, TC-062）。
import { EMPTY_MESSAGE, LOADING_MESSAGE, messageFor } from "./messages.js";
import { controlsEnabled } from "./state.js";

/** 1 行（li）を作る。タスク名は textContent のみ。 */
export function renderTask(doc, task) {
  const li = doc.createElement("li");
  li.className = "task";
  li.dataset.id = task.id;

  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "task-check";
  checkbox.setAttribute("aria-label", `「${task.title}」を完了にする`);

  const title = doc.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;

  const remove = doc.createElement("button");
  remove.type = "button";
  remove.className = "delete";
  remove.textContent = "削除";
  remove.setAttribute("aria-label", `「${task.title}」を削除`);

  li.append(checkbox, title, remove);
  updateTask(li, task, false);
  return li;
}

/** 既存の行を状態に合わせる。通信中の行は、利用者が押した直後のチェック表示を成否が分かるまで保つ。 */
export function updateTask(li, task, busy) {
  const checkbox = li.querySelector(".task-check");
  if (!busy) checkbox.checked = task.completed;
  li.classList.toggle("done", task.completed);
  li.classList.toggle("busy", busy);
  li.setAttribute("aria-busy", String(busy));
}

/** タスク ID をキーに、行を作り直さず並びだけ合わせる（フォーカスを保つため）。 */
function syncRows(doc, list, tasks, busyIds) {
  const existing = new Map([...list.children].map((li) => [li.dataset.id, li]));
  let cursor = list.firstElementChild;
  for (const task of tasks) {
    let li = existing.get(task.id);
    if (li) {
      existing.delete(task.id);
      updateTask(li, task, busyIds.includes(task.id));
    } else {
      li = renderTask(doc, task);
    }
    if (li === cursor) cursor = cursor.nextElementSibling;
    else list.insertBefore(li, cursor);
  }
  for (const stale of existing.values()) stale.remove();
}

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function listMessage(state) {
  if (state.phase === "loading") return LOADING_MESSAGE;
  if (state.phase === "ready" && state.tasks.length === 0) return EMPTY_MESSAGE;
  return "";
}

export function createView(doc) {
  const el = {
    form: doc.getElementById("add-form"),
    input: doc.getElementById("title-input"),
    add: doc.getElementById("add-button"),
    inputError: doc.getElementById("input-error"),
    saveError: doc.getElementById("save-error"),
    retry: doc.getElementById("retry-button"),
    message: doc.getElementById("list-message"),
    list: doc.getElementById("task-list"),
  };

  function renderErrors(state) {
    setText(el.saveError, state.topError ? messageFor(state.topError) : "");
    setText(el.inputError, state.inputError ? messageFor(state.inputError) : "");
    if (state.inputError) el.input.setAttribute("aria-invalid", "true");
    else el.input.removeAttribute("aria-invalid");
    el.retry.hidden = state.phase !== "load-error";
  }

  function renderControls(state) {
    el.input.disabled = !controlsEnabled(state);
    el.add.disabled = !controlsEnabled(state) || state.submitting;
  }

  /** 削除などでフォーカス中の行が消えたら、近い行のチェックボックス（無ければ一覧のメッセージ）へ移す。 */
  function keepFocus(rowIndex) {
    if (rowIndex < 0 || el.list.contains(doc.activeElement)) return;
    const rows = el.list.children;
    const next = rows[Math.min(rowIndex, rows.length - 1)];
    (next?.querySelector(".task-check") ?? el.message).focus();
  }

  function renderList(state) {
    const focused = doc.activeElement?.closest?.("li.task");
    const rowIndex = focused && el.list.contains(focused) ? [...el.list.children].indexOf(focused) : -1;
    syncRows(doc, el.list, state.phase === "ready" ? state.tasks : [], state.busyIds);
    el.list.hidden = el.list.children.length === 0;
    setText(el.message, listMessage(state));
    el.message.hidden = el.message.textContent === "";
    keepFocus(rowIndex);
  }

  return {
    render(state) {
      renderErrors(state);
      renderControls(state);
      renderList(state);
    },
    getInputValue: () => el.input.value,
    clearInput() {
      el.input.value = "";
    },
    focusInput: () => el.input.focus(),
    bind(handlers) {
      el.form.addEventListener("submit", (event) => {
        event.preventDefault();
        handlers.onSubmit();
      });
      el.input.addEventListener("input", () => handlers.onInput());
      el.retry.addEventListener("click", () => handlers.onRetry());
      el.list.addEventListener("change", (event) => {
        const row = event.target.closest("li.task");
        if (row && event.target.matches(".task-check"))
          handlers.onToggle(row.dataset.id, event.target.checked);
      });
      el.list.addEventListener("click", (event) => {
        const row = event.target.closest("li.task");
        if (row && event.target.closest("button.delete")) handlers.onDelete(row.dataset.id);
      });
    },
  };
}
