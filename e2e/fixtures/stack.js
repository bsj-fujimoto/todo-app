// 各テストが専用のスタック（backend プロセス + frontend 配信サーバー + 一時 DB + 空きポート）を持つ fixture。
// テスト間で状態・ポート・ファイルを共有しないので、並列実行しても汚染しない（docs/03-test-spec.md §12）。
import { expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { corruptDbFile, readRows, seedTasks, sha256File } from "../../backend/test-support/index.js";
import { createLogBuffer, startBackendProcess, stopChild } from "./backend-process.js";
import { startFrontendServer } from "./frontend-server.js";
import { test as observedTest } from "./observe.js";
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

/** backend プロセスの起動・停止（未起動の状態で始め、start() で起動する）。start / stop は 1 つのテストから逐次に呼ぶ。 */
function backendController({ dbPath, logs }) {
  let backend = null;
  return {
    port: () => backend?.port ?? null,
    async start() {
      if (backend) return;
      // await をまたぐ代入だが、並行に呼ばないので競合しない
      // eslint-disable-next-line require-atomic-updates
      backend = await startBackendProcess({ root: ROOT, dbPath, log: logs.append });
    },
    async stop() {
      const running = backend;
      backend = null;
      await stopChild(running?.child);
    },
  };
}

const toTask = (row) => ({
  id: row.id,
  title: row.title,
  completed: row.completed === 1,
  createdAt: row.created_at,
});

/** DB への直接の操作（seed・破損・内容の確認）。 */
function databaseHelpers(dbPath, control) {
  return {
    /** DS-002 などを DB へ直接投入する（backend は操作ごとに DB を開き直すので、起動中でも次の操作から見える） */
    seed: async (rows) => seedTasks(dbPath, rows),
    /** DS-007: backend を止め、DB の先頭 100 バイトを 0x00 で上書きしてから再起動する */
    async corruptDb() {
      await control.stop();
      corruptDbFile(dbPath);
      await control.start();
    },
    dbSha256: async () => sha256File(dbPath),
    /** 保存データ（tasks テーブル）を保存順に返す。seed の行と同じ形（{ id, title, completed, createdAt }）。 */
    db: async () => readRows(dbPath).map(toTask),
  };
}

async function createStack() {
  const tmp = await mkdtemp(path.join(tmpdir(), "todo-e2e-"));
  const dbPath = path.join(tmp, "todo.db");
  const logs = createLogBuffer();
  const requests = [];
  const control = backendController({ dbPath, logs });

  const frontend = await startFrontendServer({
    frontendDir: path.join(ROOT, "frontend"),
    getBackendPort: control.port,
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
    startBackend: control.start,
    stopBackend: control.stop,
    ...databaseHelpers(dbPath, control),
    /** backend を直接呼んで保存済みのタスクを得る（画面を経由しない確認用） */
    async tasks() {
      const response = await fetch(`http://127.0.0.1:${control.port()}/api/v1/tasks`);
      return { status: response.status, body: await response.json() };
    },
    async dispose() {
      await control.stop();
      await frontend.close();
      await rm(tmp, { recursive: true, force: true });
    },
  };
  await stack.startBackend();
  return stack;
}

export const test = observedTest.extend({
  stack: async ({ observed }, use, testInfo) => {
    const stack = await createStack();
    observed.source = () => stack.requests; // 観察値（通信の記録）として使う
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
