# 画面側の性能計測用イメージ。Playwright 公式イメージ（ブラウザ同梱）に Lighthouse を足す。
# ベースは digest 固定（mcr.microsoft.com/playwright:v1.64.0-noble の マルチアーキ index）。更新は意図的に digest を取り直す。
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
WORKDIR /app
ENV PLAYWRIGHT_VERSION=1.64.0 LIGHTHOUSE_VERSION=13.5.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY measure.mjs ./
ENTRYPOINT ["node", "measure.mjs"]
