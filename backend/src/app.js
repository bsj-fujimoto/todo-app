// Fastify アプリの組み立て。時刻・ID 採番・ストア・ログ出力先はすべて引数で受け取る（環境変数・実時刻に触れない）。
import Fastify from "fastify";
import { AppError, ERROR_DEFS, SERVER_SIDE_CODES, errorBody, statusOf } from "./errors.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerTaskRoutes } from "./routes/tasks.js";

// 巨大な本文でメモリを食い尽くさない。タイトル 100000 文字（数百 KB）までは 422 で返せる大きさにする
export const BODY_LIMIT_BYTES = 1024 * 1024;
// 本文サイズ超過で 400 を返すとき、クライアントが応答を確実に受け取れるよう、残りの本文を読み捨てる上限と待ち時間。
// 宣言された Content-Length が上限を超える場合は読み捨てず、応答して接続を閉じる
export const MAX_DRAIN_BYTES = 64 * 1024 * 1024;
export const DRAIN_TIMEOUT_MS = 10_000;
const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** 受け取った x-request-id（安全な形式のときだけ）を再利用し、無ければ採番する。 */
function requestIdResolver(generate) {
  return (request) => {
    const incoming = request.headers[REQUEST_ID_HEADER];
    return typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming) ? incoming : generate();
  };
}

function sequentialRequestIds() {
  let counter = 0;
  return () => `req-${++counter}`;
}

/** 例外 → AppError。Fastify 由来の 4xx（JSON 不正・Content-Type 違い・本文サイズ超過など）は INVALID_REQUEST。 */
function toAppError(error) {
  if (error instanceof AppError) return error;
  const status = error?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return new AppError("INVALID_REQUEST", { detail: error.code, cause: error });
  }
  return new AppError("INTERNAL_ERROR", { detail: "unexpected error", cause: error });
}

/** 残りの本文を読み捨てる。読み切る・切断される・上限（量・時間）を超えるのいずれかで解決する。 */
function discardRemainder(raw) {
  return new Promise((resolve) => {
    let drained = 0;
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      raw.destroy();
      finish();
    }, DRAIN_TIMEOUT_MS);
    raw.on("data", (chunk) => {
      drained += chunk.length;
      if (drained > MAX_DRAIN_BYTES) raw.destroy();
    });
    raw.once("end", finish);
    raw.once("close", finish);
    raw.once("error", finish);
    raw.resume();
  });
}

/**
 * 本文サイズ超過（FST_ERR_CTP_BODY_TOO_LARGE）では、Fastify は connection: close を付けて即応答する。
 * 未読の本文が残ったまま接続を閉じると TCP の RST でクライアントが応答を失う（書込み中の ECONNRESET/EPIPE）。
 * そこで、上限付きで残りを読み捨ててから応答し、接続は閉じずに使い回せるようにする。
 */
async function drainOversizedBody(error, request, reply) {
  if (error?.code !== "FST_ERR_CTP_BODY_TOO_LARGE") return;
  if (Number(request.headers["content-length"]) > MAX_DRAIN_BYTES) return;
  await discardRemainder(request.raw);
  reply.removeHeader("connection");
}

async function errorHandler(error, request, reply) {
  await drainOversizedBody(error, request, reply);
  const appError = toAppError(error);
  // 利用者データ（タイトルなど）は出さない。利用者の入力ミス（4xx）は完了ログだけで足り、error にはしない
  if (SERVER_SIDE_CODES.includes(appError.code)) {
    request.log.error(
      { errorCode: appError.code, detail: appError.detail, err: appError.cause },
      ERROR_DEFS[appError.code].message,
    );
  }
  return reply.code(statusOf(appError.code)).send(errorBody(appError.code));
}

/**
 * @param {object} deps
 * @param {object} deps.store ストア（sqlite-store.js の createStore と同じ形）
 * @param {() => string} deps.clock 現在時刻を ISO 8601（UTC・ミリ秒・Z）の文字列で返す
 * @param {() => string} deps.idGenerator UUID v4 を返す
 * @param {object|false} [deps.logger] Fastify の logger 設定（{level, stream}）。省略時はログなし
 * @param {{version: string, commit: string}} deps.info health に出す版情報
 * @param {() => string} [deps.requestIdGenerator] x-request-id の採番（省略時は連番）
 */
export function buildApp({ store, clock, idGenerator, logger = false, info, requestIdGenerator }) {
  const app = Fastify({
    logger,
    bodyLimit: BODY_LIMIT_BYTES,
    requestIdHeader: false,
    genReqId: requestIdResolver(requestIdGenerator ?? sequentialRequestIds()),
    routerOptions: { ignoreTrailingSlash: true, maxParamLength: 2048 },
  });

  // 契約の paths との突き合わせ用（test/api/contract.test.js）。ルートを登録する前に付ける
  const routes = [];
  app.addHook("onRoute", (route) => routes.push({ method: route.method, url: route.url }));
  app.decorate("registeredRoutes", routes);

  app.addHook("onRequest", async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
  app.addHook("onReady", async () => {
    const status = store.status();
    if (!status.ok) {
      app.log.error(
        { errorCode: status.error.code, detail: status.error.detail },
        "データストアを開けなかった",
      );
    }
  });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) =>
    reply.code(statusOf("ROUTE_NOT_FOUND")).send(errorBody("ROUTE_NOT_FOUND")),
  );

  registerTaskRoutes(app, { store, clock, idGenerator });
  registerHealthRoute(app, { store, info });
  return app;
}
