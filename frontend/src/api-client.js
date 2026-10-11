// backend API（/api/v1）の呼び出し。fetch は注入する。例外は投げず、結果オブジェクトで返す。
const BASE = "/api/v1/tasks";

/** @typedef {{ ok: true, data: any }} Success */
/** @typedef {{ ok: false, status: number, code: string }} Failure  status 0 は通信失敗 */

const failure = (status, code) => ({ ok: false, status, code });

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function toResult(response) {
  if (response.status === 204) return { ok: true, data: null };
  const body = await readJson(response);
  if (response.ok) {
    return body === undefined ? failure(response.status, "INVALID_RESPONSE") : { ok: true, data: body };
  }
  // nginx の 502 など JSON でない応答は UNKNOWN として扱う
  return failure(response.status, body?.error?.code ?? "UNKNOWN");
}

/**
 * @param {{ fetch: typeof globalThis.fetch, baseUrl?: string }} deps
 */
export function createApiClient({ fetch, baseUrl = "" }) {
  async function request(method, path, payload) {
    const init = { method, headers: { Accept: "application/json" } };
    if (payload !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(payload);
    }
    try {
      return await toResult(await fetch(`${baseUrl}${path}`, init));
    } catch {
      return failure(0, "NETWORK_ERROR");
    }
  }

  const taskPath = (id) => `${BASE}/${encodeURIComponent(id)}`;

  return {
    async listTasks() {
      const result = await request("GET", BASE);
      if (!result.ok) return result;
      return Array.isArray(result.data?.tasks)
        ? { ok: true, data: result.data.tasks }
        : failure(200, "INVALID_RESPONSE");
    },
    createTask: (title) => request("POST", BASE, { title }),
    updateTask: (id, completed) => request("PATCH", taskPath(id), { completed }),
    deleteTask: (id) => request("DELETE", taskPath(id)),
  };
}
