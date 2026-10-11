// 各テストが専用のスタック（backend プロセス + frontend 配信サーバー + 一時 DB + 空きポート）を持つ fixture。
// テスト間で状態・ポート・ファイルを共有しないので、並列実行しても汚染しない（docs/03-test-spec.md §12）。
import { test as base, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { corruptDbFile, readRows, seedTasks, sha256File } from "../../backend/test-support/index.js";
import { createLogBuffer, startBackendProcess, stopChild } from "./backend-process.js";
import { startFrontendServer } from "./frontend-server.js";
import { TodoApp } from "./todo-app.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function completedRequests(text) {
  const started = new Map();
  const completed = [];
  for (const line of text.split("\n")) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.msg === "incoming request") started.set(entry.reqId, entry.req);
    if (entry.msg === "request completed" && started.has(entry.reqId)) {
      const { method, url } = started.get(entry.reqId);
      if (!url.startsWith("/api/v1/health")) completed.push({ method, url, status: entry.res.statusCode });
    }
  }
  return completed;
}

/** backend は未起動の状態で始め、start() で起動する。 */
async function createStack() {
  const tmp = await mkdtemp(path.join(tmpdir(), "todo-e2e-"));
  const dbPath = path.join(tmp, "todo.db");
  const logs = createLogBuffer();
  const requests = [];
  let backend = null;

  const frontend = await startFrontendServer({
    frontendDir: path.join(ROOT, "frontend"),
    getBackendPort: () => backend?.port ?? null,
    record: (entry) => requests.push(entry),
  });

  const stack = {
    url: `http://127.0.0.1:${frontend.port}`,
    dbPath,
    /** frontend 配信サーバーが中継した /api の記録（{ method, path, status, requestBody, responseBody }） */
    requests,
    calls: (method) => requests.filter((r) => !method || r.method === method),
    clearRequests: () => requests.splice(0),
    logs: () => logs.toString(),
    /** backend の標準出力（pino の JSON 行）から、完了したリクエストの { method, url, status } を出現順に返す（health を除く）。 */
    requestLog: () => completedRequests(logs.toString()),

    async startBackend() {
      if (backend) return;
      backend = await startBackendProcess({ root: ROOT, dbPath, log: logs.append });
    },
    async stopBackend() {
      const running = backend;
      backend = null;
      await stopChild(running?.child);
    },
    /** DS-002 などを DB へ直接投入する（backend は操作ごとに DB を開き直すので、起動中でも次の操作から見える） */
    seed: async (rows) => seedTasks(dbPath, rows),
    /** DS-007: backend を止め、DB の先頭 100 バイトを 0x00 で上書きしてから再起動する */
    async corruptDb() {
      await stack.stopBackend();
      corruptDbFile(dbPath);
      await stack.startBackend();
    },
    dbSha256: async () => sha256File(dbPath),
    /** 保存データ（tasks テーブル）を保存順に返す。seed の行と同じ形（{ id, title, completed, createdAt }）。 */
    db: async () =>
      readRows(dbPath).map((row) => ({
        id: row.id,
        title: row.title,
        completed: row.completed === 1,
        createdAt: row.created_at,
      })),
    /** backend を直接呼んで保存済みのタスクを得る（画面を経由しない確認用） */
    async tasks() {
      const response = await fetch(`http://127.0.0.1:${backend.port}/api/v1/tasks`);
      return { status: response.status, body: await response.json() };
    },
    async dispose() {
      await stack.stopBackend();
      await frontend.close();
      await rm(tmp, { recursive: true, force: true });
    },
  };
  await stack.startBackend();
  return stack;
}

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  stack: async ({}, use, testInfo) => {
    const stack = await createStack();
    try {
      await use(stack);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("backend.log", {
          body: stack.logs() || "(出力なし)",
          contentType: "text/plain",
        });
        await testInfo.attach("api-requests.json", {
          body: JSON.stringify(stack.requests, null, 2),
          contentType: "application/json",
        });
      }
      await stack.dispose();
    }
  },
  baseURL: async ({ stack }, use) => use(stack.url),
  app: async ({ page }, use) => use(new TodoApp(page)),
});

export { expect };
