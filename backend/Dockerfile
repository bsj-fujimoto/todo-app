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
# 実行時に npm・corepack・yarn は使わない。ベースイメージに同梱された npm の依存（brace-expansion・undici・tar など）に
# 勧告が出ても本アプリの攻撃面にならないよう、実行イメージから取り除く（trivy image が検出した high 8 件・medium 12 件・low 1 件が消える）。
# zlib は Alpine の修正版（1.3.2-r1。CVE-2026-85091）に上げる。固定したベースイメージの digest（2026-10-12 時点の最新）はまだ r0 のため、
# ここで apk upgrade する（ベースイメージが r1 以上になれば何も変わらない no-op。ベースイメージ更新時に見直す）。
# /data は非 root（node ユーザー）が書ける。VOLUME の前に作って所有者を合わせる（名前付きボリュームに引き継がれる）
RUN apk upgrade --no-cache zlib \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && mkdir -p /data && chown node:node /data
# 数値で指定する（hadolint DL3066。node ユーザーは uid 1000）
USER 1000
VOLUME ["/data"]
EXPOSE 3000
# 503（データストアに接続できない）は unhealthy になる
# exec 形式（hadolint DL3025）。PORT は環境変数から読む（ポートを変えてもずれない）。
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "backend/src/main.js"]
