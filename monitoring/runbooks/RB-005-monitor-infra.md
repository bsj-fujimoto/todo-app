# RB-005 監視そのものの不具合（実行の失敗・対象の起動失敗）

- 対象: `synthetic.yml` の実行が失敗した（監視の失敗ではなく、監視を動かす側の失敗）。compose の起動失敗、リリースイメージの取得失敗、Playwright の導入失敗、監視スクリプトのエラー（exit 2）など。
- 利用者への影響: 直接の影響は無いが、監視が止まる（見逃しの恐れ）。この runbook の失敗は「監視が見えていない時間」として扱う。
- **自動起票される incident（`[sev3][MON-META]`）**: ①`外形監視の実行に失敗`（`synthetic.yml` の `meta-alert` ジョブ。監視の結果が出る前に synthetic ジョブが失敗したとき。監視の失敗＝アプリの障害は `alert` ジョブが `[sevN][MON-xxx]` で起票するので区別される）、②`外形監視が <しきい値> 時間以上実行されていない`（`monitoring-watchdog.yml`。synthetic.yml の最終実行がしきい値〔`monitors.yaml` の `watchdog.threshold_hours`。現在 8 時間〕より前）。いずれも次の synthetic の実行が最後まで動けば（結果が出れば）、`alert` ジョブが回復を書いて自動で close する。
- 注意: GitHub の schedule は遅延・欠落しうる（cron は保証されない）。**実測では 30 分の宣言に対して実効間隔が 3.4〜6.7 時間**（`node scripts/monitoring/cadence.mjs`、`monitoring/cadence/`）。実行が来ないこと自体も見逃しの原因になる（下の「実行が来ない」）。
- watchdog の incident は、実行基盤が壊れているとは限らない。**まず `cadence.mjs` で実効間隔を測り、しきい値を超えた原因が schedule の遅延・欠落（基盤の制約）か、無効化・workflow の不具合かを切り分ける**。遅延・欠落なら `workflow_dispatch` で穴を埋めれば足り、次の実行（schedule・main への push・リリース後）が最後まで動けば自動で close する。しきい値が実効間隔に対して短すぎれば、しきい値を見直す（誤報＝閾値設計の不備。`fp-fn-log.md`）。

## 一次対応

1. Actions の `synthetic` の失敗した run を開き、失敗したステップを特定する。
2. `resolve-target` が「フォールバック」と summary に出ていれば、リリースのイメージが引けていない（リリースが無い、または GHCR のイメージ名が `monitoring/target.yaml` と違う）。監視自体は HEAD のビルドで動いている。
3. 起動ステップ（`docker compose up`）の失敗は、ログ末尾の原因（Dockerfile のビルドエラー、ポート競合、ヘルスチェック不成立）を見る。**アプリ側の不具合が原因なら RB-002** を実施する（監視が正しく失敗を捉えている）。
4. 手動で再実行する: Actions の `Run workflow`（`workflow_dispatch`）。2 回続けて失敗するなら Issue（`incident`）を手で起票する。

## 切り分け

| 症状                                                                                                                                    | 疑う場所                                                                                                                       | 確認                                                                      | 対処                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve-target` がフォールバック                                                                                                       | リリース未作成 / イメージ名の不一致                                                                                            | `gh release list`、`monitoring/target.yaml` と `release.yml` の push 先   | 名前を合わせる。リリースが無ければ正常（フォールバックは仕様）                                                                                                  |
| イメージの pull 失敗（denied / not found）                                                                                              | GHCR の権限・パッケージの公開設定                                                                                              | `docker pull ghcr.io/…@sha256:…`（ログイン済み）                          | パッケージの可視性・`packages: read` を確認                                                                                                                     |
| compose のビルド失敗                                                                                                                    | main の HEAD のビルド不具合                                                                                                    | ログ                                                                      | 修正 PR。main が壊れているので最優先                                                                                                                            |
| Playwright の導入失敗                                                                                                                   | npm / ブラウザのダウンロード                                                                                                   | ログ                                                                      | 再実行。続けば `e2e/synthetic/package-lock.json` を確認                                                                                                         |
| `外形監視が <しきい値> 時間以上実行されていない`（watchdog の incident）、または実行が来ない（実効間隔の最大〔実測 6.7 時間〕を超えて） | GitHub の cron の遅延・欠落（実測 3.4〜6.7 時間おき）・無効化（60 日無活動で schedule が無効になる）、またはしきい値が短すぎる | `node scripts/monitoring/cadence.mjs`（宣言と実測の間隔）、Actions の一覧 | `workflow_dispatch` で手動実行。リポジトリに活動があれば有効に戻る。しきい値が実効間隔より短ければ `monitors.yaml` の `watchdog.threshold_hours` を見直す（PR） |
| `alert` ジョブの失敗（Issue を作れない）                                                                                                | `issues: write` の権限                                                                                                         | ログの 403                                                                | ワークフローの permissions を確認                                                                                                                               |

## rollback

監視の設定・スクリプト・ワークフローを直前の変更前に戻す（監視の不具合は監視コードの変更が原因のことが多い）。

1. `git log --oneline -- monitoring scripts/monitoring .github/workflows/synthetic.yml` で最近の変更を見る。
2. 問題の変更を `git revert <commit>` で取り消す PR を作る（履歴を書き換えない）。レビュー（CODEOWNERS）を経てマージ。
3. 緊急時は `workflow_dispatch` で `synthetic.yml` を手動実行し、復旧を確認する。
4. アプリ側のイメージを戻す必要があるときは RB-002 の「rollback」（前のリリースのイメージ digest へ）。

## 連絡経路

- 一次: GitHub Issue（ラベル `incident`）。assignee は CODEOWNERS の既定の所有者（on-call ロール = maintainer）。
- 監視基盤自身の死活は `monitoring-watchdog.yml`（宣言 3 時間ごと。実効は 8.1 時間。しきい値 8 時間）が見るが、これも GitHub の schedule で動くため、schedule 自体が止まる（60 日無活動での無効化・GitHub 側の障害）と一緒に止まる。そのときはメンテナが定期的に Actions を確認するしかない（残存リスク）。
- 監視が止まっている間は、メンテナが手動で `synthetic.yml` を実行して穴を埋める。ack 目標 24 時間以内（sev3 相当は 72 時間）。
- 還流: 監視の見逃しが起きたら `monitoring/fp-fn-log.md` に見逃し（false negative）として記録する。

## 訓練記録

| 日時（UTC）      | 訓練                                                                                                                                                                                                                                                                                | 結果                  | 記録                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| 2026-10-11 16:2x | 実行基盤の失敗の通知試験（`synthetic.yml` の `meta_drill=true`）: synthetic ジョブを監視の結果が出る前に意図的に失敗させ、`meta-alert` が `[drill][sev3][MON-META] 外形監視の実行に失敗` を起票して close することを確認（`alert` ジョブは skipped = 監視の失敗とは区別される）     | pass                  | run 38155036726、Issue #50                                                                               |
| 2026-10-11       | `resolve-target` の動作（リリース v1.0.0 があるときは digest 固定のイメージ、無いときはフォールバック）。Actions 上の drill の `target.json` で release モードを確認                                                                                                                | pass                  | `monitoring/drills/20261011T1621Z-gha-drill-pass/target.json`、手元の `drills/*/target.json`（fallback） |
| 2026-10-12       | 死活監視の通知試験（`monitoring-watchdog.yml` の `drill_threshold_hours`）: しきい値を 0.01 時間に下げて停止と判定させ、`[drill][sev3][MON-META] 外形監視が 0.01 時間以上実行されていない` の起票 → close の経路を通す。しきい値は monitors.yaml から読み、タイトルにしきい値が入る | WATCHDOG_DRILL_RESULT | WATCHDOG_DRILL_RECORD                                                                                    |

- 実運用の事例: 2026-10-12 06:35Z に watchdog が本物の incident #59 を起票した（最終実行が 5.3 時間前 > 当時のしきい値 3 時間）。原因は製品の障害ではなく、GitHub の schedule の遅延・欠落（実効間隔 3.4〜6.7 時間）。次の schedule 実行（07:57Z、起票から約 84 分後）が最後まで動き、`alert` ジョブが回復を書いて自動で close した。しきい値 3 時間は誤報の見込みだったため 8 時間に見直した（`fp-fn-log.md`）。
- 未訓練: イメージ取得失敗・Playwright の導入失敗・cron の欠落の意図的な再現（手元・Actions では再現していない。cron の欠落は #59 が実例）、イメージ取得失敗・Playwright の導入失敗・cron の欠落（手元・Actions では意図的に再現していない）。マージ後に `monitoring-watchdog.yml` を手動実行して確認し、ここに追記する。
