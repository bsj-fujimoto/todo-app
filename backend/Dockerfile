# syntax=docker/dockerfile:1
# todo-app backend。ビルドコンテキストはリポジトリルート:
#   docker build -f backend/Dockerfile --build-arg COMMIT_SHA=$(git rev-parse HEAD) -t todo-backend .
# ベースイメージはタグ（node:24-alpine）とダイジェスト（マルチアーキの index）で固定する。
# 更新手順: docker buildx imagetools inspect node:24-alpine で Digest を確認して下の 2 か所を書き換える。

# ---- 本番依存だけを入れる段 ----
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS deps
WORKDIR /app
# ルートの package.json（workspaces 定義）・lock と backend の package.json だけで依存を解決する。
# 他の workspace（frontend・e2e）のファイルはコンテキストに無くても構わない。
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci -w backend --omit=dev --ignore-scripts && npm cache clean --force

# ---- 実行イメージ ----
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
ARG COMMIT_SHA=unknown
ENV NODE_ENV=production \
    COMMIT_SHA=${COMMIT_SHA} \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/todo.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json backend/
COPY backend/src backend/src
# /data は非 root（node ユーザー）が書ける。VOLUME の前に作って所有者を合わせる（名前付きボリュームに引き継がれる）
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
# 503（データストアに接続できない）は unhealthy になる
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/v1/health" || exit 1
CMD ["node", "backend/src/main.js"]
