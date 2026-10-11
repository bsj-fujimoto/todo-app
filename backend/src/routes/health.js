// GET /api/v1/health: 死活・準備状態と、動いている版（デプロイマーカー）。
export function registerHealthRoute(app, { store, info }) {
  app.get("/api/v1/health", async (request, reply) => {
    const status = store.status();
    if (!status.ok) {
      reply.code(503);
      request.log.warn(
        { errorCode: status.error.code, detail: status.error.detail },
        "データストアに接続できない",
      );
    }
    const dbOk = status.ok;
    return {
      status: dbOk ? "ok" : "degraded",
      version: info.version,
      commit: info.commit,
      db: dbOk ? "ok" : "error",
    };
  });
}
