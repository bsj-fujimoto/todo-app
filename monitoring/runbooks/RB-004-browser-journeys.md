# RB-004 ブラウザジャーニーが失敗（MON-007〜010）

- 対象の監視: MON-007（J-01 追加→再読込で残る）、MON-008（J-02 完了切替）、MON-009（J-03 削除）、MON-010（J-04 不正入力）。Playwright（`e2e/synthetic/journey.spec.js`）。重大度 sev2。
- 利用者への影響: API は動くのに、画面の操作が壊れている（フロントエンドの不具合・文言変更・DOM の変更）。
- 先に確認: MON-003〜006（API ジャーニー）が成功しているか。API が失敗していれば RB-003 / RB-002 を先に実施する。API が成功してブラウザだけ失敗なら画面側。

## 一次対応

1. incident Issue の「失敗の詳細」（Playwright のエラー行）と、実行の artifact（`monitoring-results-…`）にある screenshot / trace を見る。
2. 同じ操作をブラウザで手動再現する（http://localhost:8080 。合成データ。作ったものは消す）。
3. 再現しなければ一過性（デプロイ直後・負荷）。次の実行で回復するか確認し、`monitoring/fp-fn-log.md` に誤検知として記録する。
4. 再現すれば「切り分け」へ。Issue にコメント（ack）する。

## 切り分け

| 失敗の詳細（例）                                                    | 疑う場所                                                     | 確認                                             | 対処                                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getByRole(...) ... not visible` / `locator resolved to 0 elements` | 画面の DOM・ラベルの変更（監視側の locator が古い）          | screenshot と `frontend/` の最近の変更           | 意図した変更なら `e2e/synthetic/journey.spec.js` の locator を直す（監視の更新。fp-fn-log に誤検知として記録）。意図しない変更なら frontend を修正 |
| 追加後に一覧へ出ない                                                | frontend の API 呼び出し・CSP（スクリプトが読み込めない）    | ブラウザの開発者ツールのコンソール・ネットワーク | CSP ヘッダ・nginx 設定を確認。直前のリリースが原因なら「rollback」                                                                                 |
| 再読込後に消える                                                    | 保存されていない（API は成功しているのに画面が楽観更新だけ） | API ジャーニー（RB-003）と比較                   | frontend の不具合。defect を起票し「rollback」                                                                                                     |
| 空入力でエラーが出ない（MON-010）                                   | frontend の検証・エラー表示の変更                            | 手動で空入力                                     | 仕様書の文言「タスク名を入力してください」と一致しているか確認                                                                                     |
| タイムアウト                                                        | ブラウザ起動・ホストの負荷                                   | 実行の所要時間                                   | 再実行。続けば timeout_sec（monitors.yaml）を見直す（PR で）                                                                                       |

## rollback

直前のリリースが原因なら、前のリリースのイメージ（digest 固定）へ戻す。手順の全体と注意は RB-002 の「rollback」と同じ。要点:

1. 1 つ前のリリースタグの frontend / backend の digest を `docker buildx imagetools inspect ghcr.io/bsj-fujimoto/todo-app-frontend:vPREV --format '{{json .Manifest.Digest}}'` で引く。
2. `rollback.yml` に `image: …@sha256:…` を書き、`docker compose -f docker-compose.yml -f rollback.yml up -d --no-build --pull always`。
3. ブラウザジャーニーを手元で再実行: `npm ci --prefix e2e/synthetic`、`npx --prefix e2e/synthetic playwright install chromium`、`BASE_URL=http://localhost:8080 npx --prefix e2e/synthetic playwright test -c e2e/synthetic/playwright.synthetic.config.js`（`mise x -- …` 経由）。
4. Issue に戻した digest を記録し、`defect` を起票する。合成データが残っていれば（`synthetic-` で始まるタイトル）UI または API で削除する。

## 連絡経路

- 一次: GitHub Issue（ラベル `incident`）、assignee は CODEOWNERS の既定の所有者（on-call ロール = maintainer）。経路は `monitoring/alert-routes.yaml` の RT-SEV2。
- ack 目標 24 時間以内。24 時間未 ack ならリマインド。外部の連絡先は無い。
- 還流: 監視の locator 変更が原因なら `monitoring/fp-fn-log.md` に誤検知として記録し、E2E（`e2e/tests`）と locator の共通化を検討する。

## 訓練記録

（ドリル実施後に追記）
