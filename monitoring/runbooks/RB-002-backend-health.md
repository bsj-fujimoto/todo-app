# RB-002 backend health が失敗（MON-002）

- 対象の監視: MON-002（`GET /api/v1/health`）。重大度 sev1。ジャーニー J-05。
- 利用者への影響: backend が止まっている、または SQLite に接続できない。画面は開くが、一覧の読み込み・追加・完了切替・削除がすべて「保存できませんでした」になる。
- 関連: MON-003〜010 も同時に失敗していれば原因はここ（backend 停止）の可能性が高い。先に本 runbook で復旧する。

## 一次対応

目標: 15 分以内に「止まっているか・遅いか・壊れているか」を判別し、止まっていれば再起動する。

1. incident Issue の「失敗の詳細」を読む。`通信エラー`（接続拒否・タイムアウト）か、`status が 503`、`db が "error"` かを見る。
2. compose の状態を見る（監視対象のホストで実行）。
   - `docker compose ps` — backend が `running (healthy)` か。`exited` / `restarting` / `unhealthy` なら停止・異常。
   - `docker compose logs --tail 200 backend` — 直前のエラー（起動失敗・DB を開けない・メモリ不足 `OOMKilled`）を確認。
3. 停止していれば再起動する: `docker compose up -d backend`。30 秒待って `curl -s localhost:8080/api/v1/health` が `{"status":"ok",...,"db":"ok"}` を返すか確認。
4. 復旧したら Issue にコメント（ack）し、監視が次の実行で成功して自動 close されるのを待つ。close されなければ手動で close。
5. 再起動で直らない・再発する場合は「切り分け」へ。

## 切り分け

| 症状（失敗の詳細）                                          | 疑う場所                    | 確認コマンド                                                                                               | 対処                                                                                         |
| ----------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 接続拒否・タイムアウト（frontend も失敗）                   | ホスト・Docker 自体         | `docker ps`、ホストの死活                                                                                  | ホストを復旧。compose を起動し直す                                                           |
| 接続拒否（frontend は成功）                                 | backend コンテナの停止      | `docker compose ps backend`                                                                                | `docker compose up -d backend`                                                               |
| 502 / 504（nginx のエラー）                                 | nginx → backend の中継      | `docker compose logs frontend`、`docker compose exec frontend wget -qO- http://backend:3000/api/v1/health` | backend を再起動。DNS 名が変わっていれば compose を作り直す                                  |
| 503 かつ `db: "error"`                                      | SQLite を開けない           | `docker compose logs backend`、`docker compose exec backend ls -l /data`                                   | ボリュームの権限・空き容量（`df -h`）。ファイルを**上書きしない**                            |
| 500 `DATA_CORRUPT`（一覧で発生。health は ok のことがある） | DB ファイルの破損           | `docker compose logs backend` の `DATA_CORRUPT`                                                            | 破損を直そうとしない。ボリュームのバックアップを取り、メンテナに連絡（自動上書きしない仕様） |
| 応答が遅い（latency のみ失敗、sev3 相当）                   | CPU・メモリ飽和、件数の増加 | `docker stats --no-stream`、`GET /api/v1/tasks` の件数                                                     | perf/analysis.md の残存リスクを参照。件数が多ければ容量計画（perf/analysis.md）に従う        |
| version / commit の不一致（status は ok）                   | 意図しない版が動いている    | `curl -s localhost:8080/api/v1/health`、`docker compose images`                                            | 意図した版でなければ「rollback」                                                             |

## rollback

直前のデプロイ（リリース）が原因と疑われるときに、前のリリースのイメージ（digest 固定）へ戻す。

1. 戻す先を決める: GitHub Releases で 1 つ前のタグ（例 `vPREV`）を確認する。現在の版は `curl -s localhost:8080/api/v1/health` の `version` / `commit`。
2. 前のリリースのイメージ digest を引く（コマンドは Docker のみ。ホストに追加ツールは要らない）。
   - `docker buildx imagetools inspect ghcr.io/bsj-fujimoto/todo-app-backend:vPREV --format '{{json .Manifest.Digest}}'`
   - frontend も同様に（`todo-app-frontend`）。
3. SQLite のボリューム（`todo-data`）をバックアップする（スキーマ移行が戻せない版かもしれないため）。
   - `docker run --rm -v todo-data:/data -v "$PWD":/backup alpine tar czf /backup/todo-data-backup.tgz -C /data .`
4. 上書きファイル `rollback.yml` を作る（digest 固定）。
   ```yaml
   services:
     backend:
       image: ghcr.io/bsj-fujimoto/todo-app-backend@sha256:<手順 2 の digest>
     frontend:
       image: ghcr.io/bsj-fujimoto/todo-app-frontend@sha256:<手順 2 の digest>
   ```
5. 入れ替える: `COMMIT_SHA=<戻す版の commit> docker compose -f docker-compose.yml -f rollback.yml up -d --no-build --pull always`（`COMMIT_SHA` を渡さないと health の commit が `unknown` になる。#16）
6. 確認: `curl -s localhost:8080/api/v1/health` の version / commit が戻した版か。`node scripts/monitoring/run-monitors.mjs --base-url http://localhost:8080 --out monitoring/out` が全部成功か。
7. incident Issue の「ロールバック有無」に戻した digest を書き、`defect` を起票して原因の版を記録する。再リリースは修正後。

注意: 戻した版が古い DB スキーマを前提とし、現在の DB が新しいスキーマに移行済みの場合、起動に失敗する（migrations は前方のみ）。そのときはバックアップから復元せず、メンテナに連絡する。

## 連絡経路

- 一次: GitHub Issue（ラベル `incident`）。assignee は CODEOWNERS の既定の所有者（on-call ロール = maintainer）。経路定義は `monitoring/alert-routes.yaml`（RT-SEV1）。
- ack 目標: 24 時間以内（Issue へのコメント、または assignee の確認）。12 時間で未 ack ならリマインド、24 時間で `ack-overdue`。
- 外部の連絡先（電話・チャット）は無い（個人用アプリ。単一メンテナの残存リスク）。
- 復旧後: incident Issue の「再発防止」チェックリスト（defect・テスト・監視・runbook）を埋める。`monitoring/fp-fn-log.md` に誤検知・見逃しがあれば記録する。

## 訓練記録

| 日時（UTC）      | 訓練                                                                                                                                                | 結果 | 所要                             | 記録                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------- | ------------------------------------------------ |
| 2026-10-11 07:25 | 悪いリリースの検知 → 一次対応（health の commit・`docker compose ps`・ログ）→ rollback（`rollback.yml` で前のイメージへ。`--no-build`）→ 監視で確認 | pass | 検知から rollback 完了まで 16 秒 | `monitoring/drills/20261011T0725Z-rollback/`     |
| 2026-10-11 07:27 | backend 停止 → 一次対応（`docker compose up -d backend`）→ 監視の回復                                                                               | pass | 検知から 31 秒                   | `monitoring/drills/20261011T0726Z-notification/` |

- 訓練で見つかった不備: 焼き込み済みイメージを `COMMIT_SHA` 未指定で起動すると health の commit が `unknown` になる（#16）。rollback の手順に `COMMIT_SHA` の指定を追記した。
- 限界: 前のイメージは**ローカルでタグ固定したもの**。GHCR の digest の取得（`docker buildx imagetools inspect`）と digest 固定の pull は未検証（リリースが無い）。DB のスキーマ移行が前方のみの場合の戻しは未訓練。
- 次回: 最初のリリース後に、GHCR の digest で rollback を訓練する。
