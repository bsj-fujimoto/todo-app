// 環境変数 → 設定（純粋関数。process.env を直接読まず、呼び出し側が渡す）。
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

function parsePort(raw) {
  if (raw === undefined || raw === "") return 3000;
  if (!/^\d+$/.test(raw) || Number(raw) > 65535)
    throw new Error(`PORT は 0〜65535 の整数で指定してください: ${raw}`);
  return Number(raw);
}

function parseLogLevel(raw) {
  if (raw === undefined || raw === "") return "info";
  if (!LOG_LEVELS.includes(raw)) throw new Error(`LOG_LEVEL は ${LOG_LEVELS.join("/")} のいずれか: ${raw}`);
  return raw;
}

function orDefault(raw, fallback) {
  return raw === undefined || raw === "" ? fallback : raw;
}

/** @param {Record<string, string | undefined>} env */
export function loadConfig(env) {
  return {
    port: parsePort(env.PORT),
    host: orDefault(env.HOST, "0.0.0.0"),
    dbPath: orDefault(env.DB_PATH, "/data/todo.db"),
    commitSha: orDefault(env.COMMIT_SHA, "unknown"),
    logLevel: parseLogLevel(env.LOG_LEVEL),
  };
}
