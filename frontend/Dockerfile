# frontend（静的ファイル + nginx）。ビルドコンテキストはリポジトリルート:
#   docker build -f frontend/Dockerfile .
# ベースイメージはダイジェストで固定する（更新: docker buildx imagetools inspect nginxinc/nginx-unprivileged:stable-alpine-slim）。
# slim 版を使う理由: 画像・XSLT 用のモジュール（libgd・libtiff など）を含まず、本アプリ（静的配信と /api の中継だけ）に要らない
# ライブラリの勧告（libtiff の high など）を持ち込まない。
FROM nginxinc/nginx-unprivileged:stable-alpine-slim@sha256:3af0c10d960cc2502427fe1219c52989d309e7d65596869c60a34fd2fa2406f0

# zlib は Alpine の修正版（1.3.2-r1。CVE-2026-85091）に上げる。固定したベースイメージの digest（2026-10-12 時点の最新）はまだ r0 のため、
# root で apk upgrade してから非 root に戻す（ベースイメージが r1 以上になれば何も変わらない no-op。ベースイメージ更新時に見直す）。
USER root
RUN apk upgrade --no-cache zlib

# 非 root（nginx ユーザー）で 8080 を待ち受ける。設定は conf.d/default.conf を置き換える。
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/index.html frontend/styles.css frontend/favicon.svg /usr/share/nginx/html/
COPY frontend/src/ /usr/share/nginx/html/src/

# 非 root で実行する（ベースイメージも nginx ユーザーだが、Dockerfile でも明示する。trivy DS-0002 / hadolint DL3066）。
USER 101

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
