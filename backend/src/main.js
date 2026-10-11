// composition root: 時刻・UUID・環境変数・実ファイルに触れるのはここだけ。
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createStore } from "./store/sqlite-store.js";

const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"];

function readVersion() {
  const packageJson = new URL("../package.json", import.meta.url);
  return JSON.parse(readFileSync(packageJson, "utf8")).version;
}

function compose(config) {
  // DB ファイルの親ディレクトリだけ用意する（ファイル自体は SQLite が初回に作る。既存ファイルには触れない）
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const clock = () => new Date().toISOString();
  const store = createStore({ dbPath: config.dbPath, clock });
  const app = buildApp({
    store,
    clock,
    idGenerator: randomUUID,
    requestIdGenerator: randomUUID,
    logger: { level: config.logLevel },
    info: { version: readVersion(), commit: config.commitSha },
  });
  return { app, store };
}

function installShutdown({ app, store }) {
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "シャットダウンを開始する");
    try {
      await app.close();
    } finally {
      store.close();
    }
  };
  for (const signal of SHUTDOWN_SIGNALS) process.on(signal, () => shutdown(signal));
}

async function main() {
  const config = loadConfig(process.env);
  const parts = compose(config);
  installShutdown(parts);
  try {
    await parts.app.listen({ port: config.port, host: config.host });
  } catch (error) {
    parts.app.log.fatal({ err: error }, "起動に失敗した");
    parts.store.close();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
