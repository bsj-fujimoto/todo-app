// docker compose の本物の nginx・コンテナ・ボリューム（@compose。直列実行）: TC-043、TC-044、TC-076、TC-077。
// 専用のプロジェクト名 todoapp-e2e と空きポートで起動し、各テストの前後で `down -v` して独立させる。
import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { freePort } from "../fixtures/backend-process.js";
import { test as observedTest } from "../fixtures/observe.js";
import { TodoApp } from "../fixtures/todo-app.js";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECT = "todoapp-e2e";

async function createCompose() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, FRONTEND_PORT: String(port), COMMIT_SHA: "e2e" };
  const run = async (...args) => {
    const { stdout } = await exec("docker", ["compose", "-p", PROJECT, ...args], {
      cwd: ROOT,
      env,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  };
  const docker = async (...args) => (await exec("docker", args, { cwd: ROOT, env })).stdout;
  const get = async (pathname, headers = {}) => {
    try {
      return await fetch(`${url}${pathname}`, { headers });
    } catch {
      return null;
    }
  };

  return {
    port,
    url,
    run,
    docker,
    get,
    up: () => run("up", "-d", "--build", "--wait", "--wait-timeout", "180"),
    down: (...flags) => run("down", ...flags, "--remove-orphans"),
    /** frontend オリジン経由の /api/v1/health が 200 になるまでの時間（ミリ秒）。timeoutMs を超えたら失敗。 */
    async waitHealthy(timeoutMs) {
      const start = performance.now();
      for (;;) {
        const response = await get("/api/v1/health");
        if (response?.status === 200) return Math.round(performance.now() - start);
        if (performance.now() - start > timeoutMs)
          throw new Error(`health が ${timeoutMs}ms 以内に 200 にならない`);
        await sleep(500);
      }
    },
    async tasks() {
      const response = await get("/api/v1/tasks");
      return { status: response.status, body: await response.json() };
    },
    async services() {
      const lines = (await run("ps", "--all", "--format", "json")).trim().split("\n").filter(Boolean);
      return lines.map((line) => JSON.parse(line));
    },
  };
}

const test = observedTest.extend({
  // eslint-disable-next-line no-empty-pattern
  compose: async ({}, use, testInfo) => {
    const compose = await createCompose();
    await compose.down("-v");
    try {
      await use(compose);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        const logs = await compose.run("logs", "--no-color").catch((error) => String(error));
        await testInfo.attach("compose.log", { body: logs, contentType: "text/plain" });
      }
      await compose.down("-v");
    }
  },
  baseURL: async ({ compose }, use) => use(compose.url),
  app: async ({ page }, use) => use(new TodoApp(page)),
});

test.describe("docker compose（本物の nginx・コンテナ・ボリューム）", () => {
  test(
    "[TC-076] docker compose up --build で起動し、frontend 経由で画面と API が動く",
    { tag: ["@compose", "@smoke"] },
    async ({ compose, app, page, request }) => {
      const consoleErrors = [];
      page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
      page.on("pageerror", (error) => consoleErrors.push(String(error)));

      await compose.up();

      // 2 サービスが running。backend のポートはホストへ公開されない
      const services = await compose.services();
      expect(services.map((s) => [s.Service, s.State]).sort()).toEqual([
        ["backend", "running"],
        ["frontend", "running"],
      ]);
      const backend = services.find((s) => s.Service === "backend");
      expect((backend.Publishers ?? []).filter((p) => p.PublishedPort > 0)).toEqual([]);

      // frontend オリジン経由の health（nginx の /api 中継が backend へ届く）
      const health = await request.get(`${compose.url}/api/v1/health`);
      expect(health.status()).toBe(200);
      expect(await health.json()).toMatchObject({ status: "ok", db: "ok" });

      // 画面: 空状態 → 追加 → 一覧。コンソールエラー（CORS を含む）なし
      await app.open();
      await expect(app.heading).toBeVisible();
      await expect(app.emptyMessage).toBeVisible();
      await app.add("買い物");
      await app.expectTitles(["買い物"]);
      await app.expectNoErrors();
      expect(consoleErrors).toEqual([]);

      // ボリュームと保存データ
      const volumes = await compose.docker("volume", "ls", "--format", "{{.Name}}");
      expect(volumes.split("\n")).toContain(`${PROJECT}_todo-data`);
      expect((await compose.tasks()).body.tasks.map((t) => t.title)).toEqual(["買い物"]);

      // 本物の nginx の挙動: セキュリティヘッダ・gzip・/healthz・非 root
      const page1 = await request.get(`${compose.url}/`);
      expect(page1.headers()).toMatchObject({
        "content-security-policy": "default-src 'self'",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
      });
      const css = await request.get(`${compose.url}/styles.css`, { headers: { "accept-encoding": "gzip" } });
      expect(css.headers()["content-encoding"]).toBe("gzip");
      expect((await request.get(`${compose.url}/healthz`)).status()).toBe(200);
      expect((await compose.run("exec", "-T", "frontend", "id", "-u")).trim()).not.toBe("0");
      const apiHeaders = (await request.get(`${compose.url}/api/v1/tasks`)).headers();
      expect(apiHeaders["x-content-type-options"]).toBe("nosniff"); // /api 応答にもセキュリティヘッダが付く
    },
  );

  test(
    "[TC-043] backend の再起動・スタック全体の再起動の後も、タスクが保持される",
    { tag: ["@compose", "@resilience"] },
    async ({ compose, app, page, observe }) => {
      await compose.up();
      await app.open();
      await app.add("買い物");
      await app.add("資料を印刷する");
      await app.expectTitles(["資料を印刷する", "買い物"]);
      await app.checkbox("資料を印刷する").click();
      await expect(app.checkbox("資料を印刷する")).toBeChecked();
      const before = (await compose.tasks()).body.tasks;
      expect(before).toHaveLength(2);

      // backend だけ再起動
      await compose.run("restart", "backend");
      const restartMs = await compose.waitHealthy(60_000);
      observe("backend 再起動後の health 200 まで(ms)", restartMs);
      await page.reload();
      await app.expectTitles(["資料を印刷する", "買い物"]);
      await app.expectStrikethrough("資料を印刷する", true);
      await app.expectNoErrors();
      expect((await compose.tasks()).body.tasks).toEqual(before);

      // スタック全体を停止 → 開始
      await compose.run("stop");
      await compose.run("start");
      await compose.waitHealthy(120_000);
      await page.reload();
      await app.expectTitles(["資料を印刷する", "買い物"]);
      await expect(app.checkbox("資料を印刷する")).toBeChecked();
      await app.expectNoErrors();
      expect((await compose.tasks()).body.tasks).toEqual(before);
    },
  );

  test(
    "[TC-044] down ではボリュームが残りタスクが保持され、down -v で失われる",
    { tag: ["@compose", "@resilience"] },
    async ({ compose, app }) => {
      await compose.up();
      await app.open();
      await app.add("買い物");
      await app.expectTitles(["買い物"]);

      // down（ボリュームは残す）→ up
      await compose.down();
      await compose.up();
      await app.open();
      await app.expectTitles(["買い物"]);
      await app.expectNoErrors();

      // down -v（ボリュームも削除）→ up: 新しいボリュームで 0 件
      await compose.down("-v");
      await compose.up();
      await app.open();
      await expect(app.emptyMessage).toBeVisible();
      await app.expectNoErrors();
      const { status, body } = await compose.tasks();
      expect([status, body]).toEqual([200, { tasks: [] }]);
      expect((await compose.get("/api/v1/health")).status).toBe(200);
    },
  );

  test(
    "[TC-077] backend を止めると外形監視（health）が 502/504 で検知でき、画面は保存失敗を示し、起動後 30 秒以内に回復する",
    { tag: ["@compose", "@resilience"] },
    async ({ compose, app, observe }) => {
      await compose.up();
      expect((await compose.get("/api/v1/health")).status).toBe(200);
      await app.open();

      await compose.run("stop", "backend");
      const stopped = await compose.get("/api/v1/health");
      observe("backend 停止中の health", stopped.status);
      expect([502, 504]).toContain(stopped.status);

      await app.add("買い物");
      await expect(app.saveError).toHaveText("保存できませんでした。もう一度お試しください");
      await expect(app.rows).toHaveCount(0);
      await expect(app.input).toHaveValue("買い物");

      await compose.run("start", "backend");
      const recoveredMs = await compose.waitHealthy(30_000);
      observe("start backend から health 200 まで(ms)", recoveredMs);
      expect((await compose.tasks()).body.tasks).toEqual([]);
    },
  );
});
