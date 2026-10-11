# RB-003 API ジャーニーが失敗（MON-003〜006）

- 対象の監視: MON-003（J-01 追加→一覧に残る）、MON-004（J-02 完了切替）、MON-005（J-03 削除）、MON-006（J-04 不正入力が弾かれる）。重大度 sev2。
- 利用者への影響: 画面は開くが、追加・完了切替・削除・入力検証のいずれかが壊れている。入力した内容が失われる、または不正な入力が保存される。
- 先に確認: MON-002（health）も失敗していれば RB-002 を先に実施する。

## 一次対応

1. incident Issue の「失敗の詳細」の `step <id>:` で、どの手順（create / list / complete / verify / delete / empty / too-long …）で何が違ったかを読む。
2. 同じ手順を手で再現する（合成データ。作ったものは必ず消す）。
   - `curl -s -X POST localhost:8080/api/v1/tasks -H 'content-type: application/json' -d '{"title":"手動確認"}'`
   - 返った `id` で `curl -s -X PATCH localhost:8080/api/v1/tasks/<id> -H 'content-type: application/json' -d '{"completed":true}'`、`curl -s -X DELETE localhost:8080/api/v1/tasks/<id>`。
3. 再現できなければ一過性（デプロイ直後・負荷）。次の実行で回復するか確認し、`monitoring/fp-fn-log.md` に誤検知として記録する。
4. 再現すれば「切り分け」へ。Issue にコメント（ack）して状況を書く。

## 切り分け

| 失敗の詳細                                                | 疑う場所                                  | 確認                                                                              | 対処                                                                                                            |
| --------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `step create: status が 5xx` / `STORAGE_FAILURE`          | SQLite に書けない（容量・権限・読取専用） | `docker compose logs backend`、`docker compose exec backend ls -l /data`、`df -h` | 容量・権限を直す。DB ファイルを上書きしない                                                                     |
| `step list: … の要素が無い（永続化されていない）`         | 書込みが保存されていない                  | ボリューム `todo-data` が付いているか `docker compose config`                     | ボリュームの設定を直す。再起動でデータが消えていないか確認                                                      |
| `契約違反（Task）` / `契約にないフィールド`               | API の応答が openapi.yaml と違う          | `curl -s localhost:8080/api/v1/tasks \| head`、`backend/openapi.yaml`             | 直前の変更（PR）を確認。契約の変更か実装の不具合かを判断し defect を起票                                        |
| `step complete: completed が …`                           | 更新が反映されない                        | backend ログ、`PATCH` を手で再現                                                  | 実装の不具合なら「rollback」                                                                                    |
| `step delete-again: status が 200`（再削除が 404 でない） | 削除の冪等性が変わった                    | 手で DELETE を 2 回                                                               | 契約（TASK_NOT_FOUND）に反するので defect                                                                       |
| MON-006: `error.code` が違う / 件数が増えた               | 入力検証の変更                            | `POST` に空・101 文字・改行を手で送る                                             | 不正入力が保存されたら**直ちに** rollback。保存された行は手動で削除（本番データを誤って消さないよう id を確認） |
| 応答時間のみ失敗（`応答 …ms > 300ms`、sev3 相当）         | 件数増加・負荷                            | `GET /api/v1/tasks` の件数と所要時間、`docker stats`                              | perf/analysis.md の容量計画を参照                                                                               |

## rollback

直前のリリースで始まった失敗なら、前のリリースのイメージ（digest 固定）へ戻す。手順の全体と注意（DB バックアップ、スキーマ移行が前方のみであること）は RB-002 の「rollback」と同じ。要点:

1. `docker buildx imagetools inspect ghcr.io/bsj-fujimoto/todo-app-backend:vPREV --format '{{json .Manifest.Digest}}'` で backend の digest を引く（frontend も同様）。
2. DB ボリュームをバックアップ: `docker run --rm -v todo-data:/data -v "$PWD":/backup alpine tar czf /backup/todo-data-backup.tgz -C /data .`
3. `rollback.yml` に `image: …@sha256:…` を書き、`COMMIT_SHA=<戻す版の commit> docker compose -f docker-compose.yml -f rollback.yml up -d --no-build --pull always`（`COMMIT_SHA` を渡さないと health の commit が `unknown` になる。#16）。
4. 失敗した監視を手で再実行して確認: `node scripts/monitoring/run-monitors.mjs --base-url http://localhost:8080 --out monitoring/out --only MON-003,MON-004,MON-005,MON-006`。
5. Issue に戻した digest を記録し、`defect` を起票する。合成データが残っていれば（`synthetic-` で始まるタイトル）削除する。

## 連絡経路

- 一次: GitHub Issue（ラベル `incident`）、assignee は CODEOWNERS の既定の所有者（on-call ロール = maintainer）。経路は `monitoring/alert-routes.yaml` の RT-SEV2。
- ack 目標 24 時間以内。24 時間未 ack ならリマインド。外部の連絡先は無い。
- 還流: 原因が判明したら incident Issue の「再発防止」を埋め、必要なら `docs/data/cases.csv` に回帰テストを追加する。

## 訓練記録

| 日時（UTC）             | 訓練                                                                                                                                                                                                   | 結果                    | 記録                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------- |
| 2026-10-11 07:21〜07:29 | backend / frontend 停止時に MON-003 が失敗し、失敗詳細（`step create: status が 502`、`通信エラー: fetch failed（ECONNREFUSED）`）から手順と原因の層を読み取れることを確認（一次対応 1）。復旧後に回復 | 一部（一次対応 1 のみ） | `monitoring/drills/20261011T0726Z-notification/`、`20261011T0729Z-frontend/` |

- 未訓練: 手での再現（一次対応 2）と、切り分け表の個別行（契約違反・永続化されない・入力検証の崩れ）。これらは意図的に不具合を作る訓練が必要で、未実施。
