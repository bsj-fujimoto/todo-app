// API テストの土台。テストごとに専用ディレクトリ・専用 DB・固定 clock・連番 id・本物の SQLite で backend を起動する。
// 既定では、契約（openapi.yaml）に載っている operation への応答はすべてその場で契約検証する。
import { Writable } from "node:stream";
import { buildApp } from "../../src/app.js";
import { createStore } from "../../src/store/sqlite-store.js";
import { createSandbox } from "../../test-support/sandbox.js";
import { fixedClock, sequentialIdGenerator, sequentialRequestIds } from "../../test-support/clock.js";
import { observeEachTest } from "../../test-support/observe-node-test.js";
import { assertContract } from "./contract.js";

/** このテストファイルの全テストが観察した値（API 呼び出し・note）。終了時に test-results/observations/ へ書かれる。 */
export const observations = observeEachTest({ layer: "api", component: "backend" });
/** テストが「実際に見た値」を残す（例: observe("p95", "追加 120ms")）。アサーションの代わりにはしない。 */
export const observe = (label, value) => observations.note(label, value);

export const DEFAULT_NOW = "2026-10-05T10:00:00.000Z";
export const INFO = Object.freeze({ version: "1.0.0-test", commit: "unknown" });

/** pino の JSON 行を溜めるストリーム。 */
function logCollector() {
  const lines = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      for (const line of chunk.toString().split("\n")) if (line.trim() !== "") lines.push(JSON.parse(line));
      callback();
    },
  });
  return { stream, lines };
}

function completedRequests(lines) {
  const incoming = new Map(
    lines.filter((line) => line.msg === "incoming request").map((line) => [line.reqId, line.req]),
  );
  return lines
    .filter((line) => line.msg === "request completed")
    .map((line) => ({
      reqId: line.reqId,
      method: incoming.get(line.reqId)?.method,
      url: incoming.get(line.reqId)?.url,
      statusCode: line.res.statusCode,
      level: line.level,
    }));
}

function parseBody(text, contentType) {
  if (text === "" || !contentType?.startsWith("application/json")) return undefined;
  return JSON.parse(text);
}

function parseBodyOrNothing(text) {
  try {
    return text === "" ? undefined : JSON.parse(text);
  } catch {
    return `(JSON でない本文 ${text.length} 文字)`;
  }
}

function buildRequest(method, options) {
  const headers = { ...options.headers };
  let body;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers["content-type"] ??= "application/json";
  } else if (options.raw !== undefined) {
    body = options.raw;
    headers["content-type"] ??= "application/json";
  }
  return { method, headers, body };
}

/** baseUrl の backend を呼ぶ HTTP クライアント（既定で契約検証つき）。 */
export function createClient(baseUrl, { contract = true } = {}) {
  async function request(method, path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, buildRequest(method, options));
    const text = await response.text();
    observations.call({
      method,
      path,
      status: response.status,
      request: options.json ?? (options.raw === undefined ? undefined : `(本文 ${options.raw.length} 文字)`),
      response: parseBodyOrNothing(text),
    });
    const result = {
      status: response.status,
      headers: response.headers,
      text,
      body: parseBody(text, response.headers.get("content-type")),
    };
    if (contract && options.contract !== false) assertContract(result, method, path);
    return result;
  }
  return {
    request,
    get: (path, options) => request("GET", path, options),
    post: (path, json, options) => request("POST", path, { ...options, json }),
    patch: (path, json, options) => request("PATCH", path, { ...options, json }),
    delete: (path, options) => request("DELETE", path, options),
  };
}

/**
 * 1 つのテストが使う資源（一時ディレクトリ・起動した backend）をまとめて管理し、afterEach で cleanup() する。
 */
export function createHarness() {
  const cleanups = [];

  return {
    /** 専用の一時ディレクトリ（dbPath は未作成 = DS-001 の初回起動状態）。 */
    async sandbox() {
      const sandbox = await createSandbox();
      cleanups.push(() => sandbox.cleanup());
      return sandbox;
    },

    /**
     * backend（Fastify）を空きポートで起動する。同じ dbPath で stop() → start() すれば再起動を再現できる。
     * @param {{dbPath: string, clock?: () => string, idGenerator?: () => string, contract?: boolean, info?: object}} options
     */
    async start({ dbPath, clock = fixedClock(DEFAULT_NOW), idGenerator = sequentialIdGenerator(), ...rest }) {
      const { stream, lines } = logCollector();
      const store = createStore({ dbPath, clock });
      const app = buildApp({
        store,
        clock,
        idGenerator,
        requestIdGenerator: sequentialRequestIds(),
        logger: { level: "info", stream },
        info: rest.info ?? INFO,
      });
      await app.listen({ port: 0, host: "127.0.0.1" });
      const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
      let stopped = false;
      const stop = async () => {
        if (stopped) return;
        stopped = true;
        await app.close();
        store.close();
      };
      cleanups.push(stop);
      return {
        ...createClient(baseUrl, { contract: rest.contract ?? true }),
        baseUrl,
        app,
        stop,
        /** これまでに出力されたログ（pino の JSON 行をパースしたもの）。 */
        logs: () => [...lines],
        /** 完了ログ（request completed）を、受信ログ（incoming request）の method・url と突き合わせたもの。 */
        completedLogs: () => completedRequests(lines),
      };
    },

    async cleanup() {
      for (const cleanup of cleanups.reverse()) await cleanup();
      cleanups.length = 0;
    },
  };
}

/** ログ行のうち level 50（error）以上。 */
export function errorLogs(logs) {
  return logs.filter((line) => line.level >= 50);
}
