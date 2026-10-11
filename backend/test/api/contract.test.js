// TC-037, TC-075: openapi.yaml（契約の正本）のスキーマで応答を検証する。加えて、実装と契約のずれを検出する突き合わせ。
// `npm run contract:check` はこのファイルだけを実行する。
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ERROR_DEFS } from "../../src/errors.js";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { readRows, seedTasks } from "../../test-support/db.js";
import { spawnBackend } from "../../test-support/process.js";
import { createSandbox } from "../../test-support/sandbox.js";
import { UUID_V4 } from "../helpers/assertions.js";
import { assertContract, conforms, declaredRoutes, spec } from "../helpers/contract.js";
import { DEFAULT_NOW, createClient, createHarness } from "../helpers/harness.js";
import packageJson from "../../package.json" with { type: "json" };

const [MILK] = STANDARD_TASKS;
const JSON_HEADERS = new Headers({ "content-type": "application/json; charset=utf-8" });
const SAMPLE_TASK = { id: MILK.id, title: "牛乳を買う", completed: false, createdAt: MILK.createdAt };

describe("契約（openapi.yaml）と応答の一致", () => {
  const harness = createHarness();
  afterEach(() => harness.cleanup());

  it("[TC-037] 一覧・追加の応答が契約の TaskList / Task に合い、余分なキーがなく、id は UUID v4・createdAt は UTC", async () => {
    const { dbPath } = await harness.sandbox();
    seedTasks(dbPath, STANDARD_TASKS);
    const api = await harness.start({ dbPath });

    const first = await api.get("/api/v1/tasks");
    assert.equal(first.status, 200);
    assert.match(first.headers.get("content-type"), /^application\/json/);
    assert.equal(first.body.tasks.length, 3);
    for (const task of first.body.tasks)
      assert.deepEqual(Object.keys(task).sort(), ["completed", "createdAt", "id", "title"]);

    const created = await api.post("/api/v1/tasks", { title: "資料を印刷する" });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("location"), null);
    assert.equal(created.body.title, "資料を印刷する");
    assert.equal(created.body.completed, false);
    assert.match(created.body.id, UUID_V4);
    assert.match(created.body.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const second = await api.get("/api/v1/tasks");
    assert.equal(second.body.tasks.length, 4);
    assert.deepEqual(second.body.tasks[0], created.body);

    const row = readRows(dbPath).find((candidate) => candidate.id === created.body.id);
    assert.deepEqual(
      { id: row.id, title: row.title, completed: row.completed === 1, createdAt: row.created_at },
      created.body,
    );
    assert.equal(created.body.createdAt, DEFAULT_NOW);
    assert.equal(row.completed, 0);
  });

  it("[契約] ルート一覧（実装が登録したもの）が openapi の paths と一致する", async () => {
    const { dbPath } = await harness.sandbox();
    const api = await harness.start({ dbPath });
    const implemented = api.app.registeredRoutes
      .flatMap((route) =>
        [route.method].flat().map((method) => `${method} ${route.url.replace(/:(\w+)/g, "{$1}")}`),
      )
      .filter((route) => !route.startsWith("HEAD ") && !route.startsWith("OPTIONS "));
    assert.deepEqual([...new Set(implemented)].sort(), declaredRoutes().sort());
  });

  it("[契約] リクエスト本文: 契約のスキーマに合う本文は 400 にならず、合わない本文は 400 になる", async () => {
    const { dbPath } = await harness.sandbox();
    seedTasks(dbPath, STANDARD_TASKS);
    const api = await harness.start({ dbPath });
    const createBodies = [
      { title: "a" },
      { title: "" },
      { title: "x".repeat(200) },
      {},
      { title: 1 },
      { title: "a", extra: 1 },
      [],
      null,
    ];
    const updateBodies = [
      { completed: true },
      { completed: false },
      {},
      { completed: "yes" },
      { completed: true, title: "x" },
      { title: "x" },
    ];

    for (const body of createBodies) {
      const res = await api.post("/api/v1/tasks", body);
      assert.equal(
        res.status === 400,
        !conforms("CreateTaskRequest", body),
        `POST ${JSON.stringify(body)} -> ${res.status}`,
      );
    }
    for (const body of updateBodies) {
      const res = await api.patch(`/api/v1/tasks/${MILK.id}`, body);
      assert.equal(
        res.status === 400,
        !conforms("UpdateTaskRequest", body),
        `PATCH ${JSON.stringify(body)} -> ${res.status}`,
      );
    }
  });

  it("[契約] エラーコードの列挙と文言が実装（ERROR_DEFS）と一致する", () => {
    const declared = spec.components.schemas.Error.properties.error.properties.code.enum;
    assert.deepEqual([...declared].sort(), Object.keys(ERROR_DEFS).sort());

    const quoted = (description) => [...description.matchAll(/「(.+?)」/g)].map((match) => match[1]);
    const titleInvalid = spec.components.responses.TitleInvalid.description;
    for (const code of ["TITLE_REQUIRED", "TITLE_TOO_LONG", "TITLE_MULTILINE"]) {
      const message = new RegExp(`${code}「(.+?)」`).exec(titleInvalid)[1];
      assert.equal(ERROR_DEFS[code].message, message, code);
    }
    assert.ok(
      quoted(spec.components.responses.StorageFailure.description).includes(
        ERROR_DEFS.STORAGE_FAILURE.message,
      ),
    );
    assert.ok(
      quoted(spec.components.responses.DataCorrupt.description).includes(ERROR_DEFS.DATA_CORRUPT.message),
    );
  });
});

describe("契約検証ヘルパの自己検査（ずれたら落ちること）", () => {
  const ok = (body, status = 200, headers = JSON_HEADERS, text = JSON.stringify(body)) => ({
    status,
    headers,
    text,
    body,
  });
  const check =
    (response, method = "GET", path = "/api/v1/tasks") =>
    () =>
      assertContract(response, method, path);

  it("[契約] 契約どおりの応答は通る", () => {
    assert.equal(assertContract(ok({ tasks: [SAMPLE_TASK] }), "GET", "/api/v1/tasks"), true);
    assert.equal(assertContract(ok(SAMPLE_TASK, 201), "POST", "/api/v1/tasks"), true);
    assert.equal(
      assertContract(ok(undefined, 204, new Headers(), ""), "DELETE", `/api/v1/tasks/${MILK.id}`),
      true,
    );
    assert.equal(assertContract(ok({}, 404), "GET", "/nope"), false);
  });

  it("[契約] 余分なキー・型違い・UUID/日時の形式違い・必須の欠落を検出する", () => {
    for (const task of [
      { ...SAMPLE_TASK, extra: 1 },
      { ...SAMPLE_TASK, completed: "false" },
      { ...SAMPLE_TASK, id: "abc" },
      { ...SAMPLE_TASK, createdAt: "yesterday" },
      { ...SAMPLE_TASK, title: "" },
      { id: SAMPLE_TASK.id, title: "x", completed: false },
    ]) {
      assert.throws(check(ok({ tasks: [task] })), /契約のスキーマに合わない/, JSON.stringify(task));
    }
  });

  it("[契約] 宣言のない status・content-type の違い・本文なしのはずの本文を検出する", () => {
    assert.throws(check(ok({ tasks: [] }, 418)), /宣言されていない status/);
    assert.throws(
      check(ok({ tasks: [] }, 200, new Headers({ "content-type": "text/html" }))),
      /content-type/,
    );
    assert.throws(
      check(ok(undefined, 204, new Headers(), "x"), "DELETE", `/api/v1/tasks/${MILK.id}`),
      /本文なし/,
    );
    assert.throws(
      check(ok({ error: { code: "UNKNOWN", message: "x" } }, 404), "DELETE", `/api/v1/tasks/${MILK.id}`),
    );
  });
});

describe("GET /api/v1/health（実プロセス）", () => {
  const cleanups = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups.length = 0;
  });

  async function startProcess(env) {
    const sandbox = await createSandbox();
    cleanups.push(() => sandbox.cleanup());
    const backend = await spawnBackend({ dbPath: sandbox.dbPath, env });
    cleanups.push(() => backend.stop());
    return { sandbox, backend, client: createClient(backend.url) };
  }

  it("[TC-075] 200 で {status, version, commit, db} の 4 キーだけ。version は package.json、commit は 40 桁 16 進か unknown", async () => {
    for (const commit of [undefined, "0123456789abcdef0123456789abcdef01234567"]) {
      const env = commit ? { COMMIT_SHA: commit } : { COMMIT_SHA: "" };
      const { sandbox, backend, client } = await startProcess(env);

      const res = await client.get("/api/v1/health");

      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.body).sort(), ["commit", "db", "status", "version"]);
      assert.equal(res.body.status, "ok");
      assert.equal(res.body.db, "ok");
      assert.equal(res.body.version, packageJson.version);
      assert.match(res.body.commit, /^([0-9a-f]{40}|unknown)$/);
      assert.equal(res.body.commit, commit ?? "unknown");
      assert.deepEqual(readRows(sandbox.dbPath), [], "health の呼び出しで tasks が増減しない");
      await backend.waitForLog((line) => line.msg === "request completed");
      const completed = backend.logs().filter((line) => line.msg === "request completed");
      assert.deepEqual(
        completed.map((line) => line.res.statusCode),
        [200],
      );
      await backend.stop();
    }
  });
});
