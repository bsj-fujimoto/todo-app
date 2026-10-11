# 通知試験・runbook 訓練の記録

アラート経路が実際に通ること（失敗 → incident Issue → assignee → 回復 → close）と、runbook の手順が実行できることを、**意図的な障害注入**で確かめた記録。
実施は `synthetic.yml` の `drill: true`（GitHub Actions）または `scripts/monitoring/drill.sh` / `rollback-drill.sh`（手元の compose）。生の記録は `monitoring/drills/` にある。
通知試験は少なくとも 90 日に 1 回行い、結果をここに追記する（次回の期限は表の「次回」）。

## 通知試験（アラート経路）

| 日時（UTC）      | 実施方法         | 注入した障害         | 対象の監視（severity）           | 検知 → 通知 | ack（方法）              | 検知 → 回復 | 結果 | Issue                  | 記録                                                                                     |
| ---------------- | ---------------- | -------------------- | -------------------------------- | ----------- | ------------------------ | ----------- | ---- | ---------------------- | ---------------------------------------------------------------------------------------- |
| 2026-10-11 07:21 | 手元（drill.sh） | backend コンテナ停止 | MON-002（sev1）、MON-003（sev2） | 20 秒       | 13 秒（assignee の確認） | 約 38 秒    | pass | #13、#14（close 済み） | 初回。この実施で判明した不備（失敗詳細の重複・影響欄が空・版が不明）を修正して再実施した |
| 2026-10-11 07:26 | 手元（drill.sh） | backend コンテナ停止 | MON-002（sev1）、MON-003（sev2） | 17 秒       | 10 秒（assignee の確認） | 約 31 秒    | pass | #17、#18（close 済み） | `drills/20261011T0726Z-notification/`（`alert-test.json` / `alert-test.md`）             |

- 確認項目（すべて OK）: Issue が作成された / ラベル `incident` と `drill` が付いた / assignee が CODEOWNERS の既定の所有者（bsj-fujimoto）/ 復旧を次の実行で検知 / 回復コメントの後に close された。
- **ack の扱い**: 自動の試験では人の ack を観測できない。ack 方針の「assignee の確認」に当たる、assignee（メンテナ）が設定されていることの確認までを記録した（`ack_method` に明記）。GitHub が assignee へ通知（メール・Web）を送るが、人が受け取ったことは観測できない。
- **GitHub Actions 上の実施は未**: `synthetic.yml` はこの PR がマージされるまで main に無く、Actions からの実行はできていない。マージ後に `Run workflow`（drill: true）を実施し、この表に追記する。
- 「検知 → 通知」は、障害を注入した後の最初の監視の開始から Issue 作成までの時間で、同じ実行の他の監視の完了と retry の待ち（2 秒 × 回数）、ラベル作成を含む。
- 次回: 2027-01-09 までに 1 回（90 日以内）。`synthetic.yml` の手動実行（drill: true）で行う。

## runbook 訓練

| 日時（UTC）      | runbook                                                     | 訓練の内容                                                                                                                                                                                           | 結果                                       | 記録                                                                                               |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 2026-10-11 07:25 | RB-002                                                      | 悪いリリース（別 commit のビルド）に入れ替え、デプロイマーカー（期待 commit との不一致）を監視が検知 → 一次対応（health・compose ps・ログ）→ rollback.yml で前のイメージへ戻す → 監視が全部成功      | pass（検知から rollback 完了まで 16 秒）   | `drills/20261011T0725Z-rollback/`                                                                  |
| 2026-10-11 07:27 | RB-002（一次対応）                                          | backend 停止 → `docker compose up -d backend` で復旧                                                                                                                                                 | pass（上の通知試験と同時。検知から 31 秒） | `drills/20261011T0726Z-notification/`                                                              |
| 2026-10-11 07:29 | RB-001（一次対応）、RB-003・RB-004（失敗詳細の読み方）      | frontend 停止 → MON-001（http）・MON-003（api）・MON-007（browser）が失敗し、失敗詳細（ECONNREFUSED / `page.goto: ERR_CONNECTION_REFUSED`）が出ることを確認 → `docker compose up -d frontend` で復旧 | pass（検知から復旧まで約 13 秒）           | `drills/20261011T0729Z-frontend/`                                                                  |
| 未               | RB-003 の切り分け表の個別行、RB-004 の locator 変更、RB-005 | —                                                                                                                                                                                                    | 未実施                                     | 理由: 個別の不具合（契約違反・DOM 変更・Actions の障害）を意図的に作る訓練は未実施。次の訓練で行う |

- **rollback の訓練の限界**: 前のイメージは**ローカルでタグ固定したもの**（`todo-drill/backend:good`）。GHCR のリリースが無いため、`docker buildx imagetools inspect` による digest の取得と、digest 固定での pull は**検証していない**。手順の機構（上書きファイル・`--no-build`・health の版確認・監視での確認）と判断の流れを検証した。
- **訓練で見つかった不備**: 焼き込み済みイメージを `COMMIT_SHA` 未指定で起動すると、`docker-compose.yml` の `environment` が上書きして health の commit が `unknown` になる（#16）。rollback 手順と `synthetic.yml` に `COMMIT_SHA` の指定を反映した。
