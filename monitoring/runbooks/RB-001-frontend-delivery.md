# RB-001 frontend の配信が失敗（MON-001）

- 対象の監視: MON-001（`GET /`: 200、本文に `My TODO`、CSP ヘッダ、2 秒以内）。重大度 sev1。ジャーニー J-01 の入口。
- 利用者への影響: 画面が開けない（または中身が違う）。ToDo の操作が一切できない。

## 一次対応

1. incident Issue の「失敗の詳細」を見る: 接続エラー / `status が 502・404` / `本文に "My TODO" が無い` / `Content-Security-Policy ヘッダが無い` / `応答 …ms > 2000ms`。
2. `docker compose ps` で frontend（nginx）が `running` か確認する。止まっていれば `docker compose up -d frontend`。
3. `curl -sI localhost:8080/` で 200 と `Content-Security-Policy` を確認する。
4. 直ったら Issue にコメント（ack）し、次の実行で成功して自動 close されるのを待つ。

## 切り分け

| 症状             | 疑う場所                                                       | 確認                                                                             | 対処                                                                    |
| ---------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 接続拒否         | frontend コンテナ停止・ポート競合                              | `docker compose ps`、`docker compose logs --tail 100 frontend`                   | `docker compose up -d frontend`。ポートが使用中なら競合プロセスを止める |
| 404 / 本文が違う | 静的ファイルがイメージに入っていない・別のイメージが動いている | `docker compose images`、`docker compose exec frontend ls /usr/share/nginx/html` | 意図した版でなければ「rollback」                                        |
| CSP ヘッダが無い | nginx の設定変更で `add_header` が抜けた                       | `docker compose exec frontend nginx -T \| grep -i content-security`              | 設定を直したイメージを再リリース。暫定は「rollback」                    |
| 502 / 504        | nginx は生きているが backend に届かない                        | RB-002 の切り分け                                                                | RB-002 に従う                                                           |
| 応答が遅い       | nginx / ホストの負荷                                           | `docker stats --no-stream`                                                       | perf/analysis.md を参照                                                 |

## rollback

直前のリリースが原因なら、前のリリースのイメージ（digest 固定）へ戻す。手順の全体と注意は RB-002 の「rollback」と同じ。要点:

1. 1 つ前のリリースタグの frontend / backend の digest を `docker buildx imagetools inspect ghcr.io/bsj-fujimoto/todo-app-frontend:vPREV --format '{{json .Manifest.Digest}}'` で引く。
2. `rollback.yml`（`image: …@sha256:…` を frontend / backend に指定）を作り、`COMMIT_SHA=<戻す版の commit> docker compose -f docker-compose.yml -f rollback.yml up -d --no-build --pull always`（`COMMIT_SHA` を渡さないと health の commit が `unknown` になる。#16）。
3. `curl -sI localhost:8080/` と health の version を確認し、`node scripts/monitoring/run-monitors.mjs --base-url http://localhost:8080 --out monitoring/out` で全監視が成功することを確認する。
4. Issue に戻した digest を記録し、`defect` を起票する。

## 連絡経路

- 一次: GitHub Issue（ラベル `incident`）、assignee は CODEOWNERS の既定の所有者（on-call ロール = maintainer）。経路は `monitoring/alert-routes.yaml` の RT-SEV1。
- ack 目標 24 時間以内。12 時間でリマインド、24 時間で `ack-overdue`。外部の連絡先は無い。

## 訓練記録

| 日時（UTC）      | 訓練                                                                                                                      | 結果 | 所要                     | 記録                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------ | -------------------------------------------- |
| 2026-10-11 07:29 | frontend 停止 → MON-001 が失敗（`fetch failed（ECONNREFUSED）`）→ 一次対応（`docker compose up -d frontend`）→ 監視の回復 | pass | 検知から復旧まで約 13 秒 | `monitoring/drills/20261011T0729Z-frontend/` |

- 未訓練: CSP ヘッダ欠落・本文違いの切り分け、rollback（RB-002 の訓練で機構は検証済み）。
