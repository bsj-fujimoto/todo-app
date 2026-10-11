// backend プロセス（node backend/src/main.js）の起動・停止。ポートは空きポート、DB は呼び出し側が渡す一時ファイル。
import { spawn } from "node:child_process";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

const STARTUP_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
const MAX_LOG_BYTES = 64_000;

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function probe(port) {
  return new Promise((resolve) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/api/v1/health", agent: false, timeout: 1000 },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => req.destroy());
    req.end();
  });
}

const hasExited = (child) => child.exitCode !== null || child.signalCode !== null;

/** health が何らかの HTTP 応答を返す（DB が壊れていて 503 でも可）まで待つ。 */
async function waitUntilListening(child, port, deadline) {
  while (performance.now() < deadline) {
    if (hasExited(child)) throw new Error("backend が起動中に終了した");
    if ((await probe(port)) !== null) return;
    await sleep(50);
  }
  throw new Error("backend の起動がタイムアウトした");
}

export async function stopChild(child) {
  if (!child || hasExited(child)) return;
  child.kill("SIGTERM");
  const killTimer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
  await once(child, "exit");
  clearTimeout(killTimer);
}

/**
 * @param {{ root: string, dbPath: string, env?: Record<string, string>, log: (chunk: string) => void }} options
 * @returns {Promise<{ child: import("node:child_process").ChildProcess, port: number }>}
 */
export async function startBackendProcess({ root, dbPath, env = {}, log }) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = await freePort();
    const child = spawn(process.execPath, ["backend/src/main.js"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        DB_PATH: dbPath,
        COMMIT_SHA: "e2e",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => log(chunk.toString()));
    child.stderr.on("data", (chunk) => log(chunk.toString()));
    try {
      await waitUntilListening(child, port, performance.now() + STARTUP_TIMEOUT_MS);
      return { child, port };
    } catch (error) {
      lastError = error;
      await stopChild(child);
    }
  }
  throw lastError;
}

export function createLogBuffer() {
  let text = "";
  return {
    append(chunk) {
      text = (text + chunk).slice(-MAX_LOG_BYTES);
    },
    toString: () => text,
  };
}
