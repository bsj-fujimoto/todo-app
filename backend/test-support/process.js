// backend を実プロセス（src/main.js）として起動する。再起動・環境変数・SIGTERM・起動ログの検査用。
// 空きポートは PORT=0 で OS に選ばせ、起動ログ（Server listening at ...）から読み取る。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAIN_JS = fileURLToPath(new URL("../src/main.js", import.meta.url));
const START_TIMEOUT_MS = 15000;
const LISTENING = /Server listening at http:\/\/[^:\s]+:(\d+)/;

function parseLines(text) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
}

/** stdout にデータが届くたびに probe を評価し、真値が返ったらそれで解決する（時間経過では判定しない。timeoutMs は無限待ち防止）。 */
function waitFor(probe, child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const finish = (settle, value) => {
      clearTimeout(timer);
      child.stdout.off("data", check);
      settle(value);
    };
    const check = () => {
      const found = probe();
      if (found) finish(resolve, found);
    };
    const timer = setTimeout(
      () => finish(reject, new Error(`期待するログが ${timeoutMs}ms 以内に出なかった`)),
      timeoutMs,
    );
    child.stdout.on("data", check);
    check();
  });
}

function collectOutput(child) {
  const collected = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => (collected.stdout += chunk));
  child.stderr.on("data", (chunk) => (collected.stderr += chunk));
  return collected;
}

function describeBackend(child, collected, exited, port) {
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    pid: child.pid,
    logs: () => parseLines(collected.stdout),
    stderr: () => collected.stderr,
    /** predicate に合うログ行が出るまで待つ（ログは非同期に届くため、応答の直後に logs() を見ると足りないことがある）。 */
    waitForLog: (predicate, timeoutMs = 5000) =>
      waitFor(() => parseLines(collected.stdout).find(predicate), child, timeoutMs),
    async stop(signal = "SIGTERM") {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      return exited;
    },
  };
}

function untilListening(child, collected, exited) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const detail = `${collected.stdout}\n${collected.stderr}`;
      reject(new Error(`backend が ${START_TIMEOUT_MS}ms 以内に起動しなかった\n${detail}`));
    }, START_TIMEOUT_MS);
    const check = () => {
      const match = LISTENING.exec(collected.stdout);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off("data", check);
      resolve(describeBackend(child, collected, exited, Number(match[1])));
    };
    child.stdout.on("data", check);
    exited.then(({ code }) => {
      clearTimeout(timer);
      reject(
        new Error(`backend が起動前に終了した (code=${code})\n${collected.stdout}\n${collected.stderr}`),
      );
    });
  });
}

/**
 * @param {{dbPath: string, env?: Record<string, string>}} options env は既定値（PORT=0 等）を上書きする
 * @returns {Promise<{url: string, port: number, pid: number, logs: () => object[], stderr: () => string, waitForLog: Function, stop: (signal?: string) => Promise<{code: number|null, signal: string|null}>}>}
 */
export function spawnBackend({ dbPath, env = {} }) {
  const child = spawn(process.execPath, [MAIN_JS], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", DB_PATH: dbPath, LOG_LEVEL: "info", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collected = collectOutput(child);
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  return untilListening(child, collected, exited);
}
