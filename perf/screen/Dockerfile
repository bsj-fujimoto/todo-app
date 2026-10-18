# 画面側の性能計測用イメージ。Playwright 公式イメージ（ブラウザ同梱）に Lighthouse を足す。
# ベースは digest 固定（mcr.microsoft.com/playwright:v1.64.0-noble の マルチアーキ index）。更新は意図的に digest を取り直す。
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf
WORKDIR /app
ENV PLAYWRIGHT_VERSION=1.64.0 LIGHTHOUSE_VERSION=13.5.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY measure.mjs scrub.mjs ./
# 非 root（uid 1001 = Playwright イメージの pwuser）で実行する。結果は /out（run.sh が書込み可にする）へ書く
USER 1001
# 一度きり実行のジョブ用イメージ（常駐しない）ので HEALTHCHECK は不要
HEALTHCHECK NONE
ENTRYPOINT ["node", "measure.mjs"]
