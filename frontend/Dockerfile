# frontend（静的ファイル + nginx）。ビルドコンテキストはリポジトリルート:
#   docker build -f frontend/Dockerfile .
# ベースイメージはダイジェストで固定する（更新: docker buildx imagetools inspect nginxinc/nginx-unprivileged:stable-alpine）。
FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3

# 非 root（nginx ユーザー）で 8080 を待ち受ける。設定は conf.d/default.conf を置き換える。
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/index.html frontend/styles.css frontend/favicon.svg /usr/share/nginx/html/
COPY frontend/src/ /usr/share/nginx/html/src/

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
