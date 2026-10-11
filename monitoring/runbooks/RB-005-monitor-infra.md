# RB-005 監視そのものの不具合（実行の失敗・対象の起動失敗）

- 対象: `synthetic.yml` の実行が失敗した（監視の失敗ではなく、監視を動かす側の失敗）。compose の起動失敗、リリースイメージの取得失敗、Playwright の導入失敗、監視スクリプトのエラー（exit 2）など。
- 利用者への影響: 直接の影響は無いが、監視が止まる（見逃しの恐れ）。この runbook の失敗は「監視が見えていない時間」として扱う。
- **自動起票される incident（`[sev3][MON-META]`）**: ①`外形監視の実行に失敗`（`synthetic.yml` の `meta-alert` ジョブ。監視の結果が出る前に synthetic ジョブが失敗したとき。監視の失敗＝アプリの障害は `alert` ジョブが `[sevN][MON-xxx]` で起票するので区別される）、②`外形監視が 3 時間以上実行されていない`（`monitoring-watchdog.yml`。synthetic.yml の最終実行が 3 時間より前）。いずれも次の synthetic の実行が最後まで動けば（結果が出れば）、`alert` ジョブが回復を書いて自動で close する。
- 注意: GitHub の schedule は遅延・欠落しうる（cron は保証されない）。実行が来ないこと自体も見逃しの原因になる（下の「実行が来ない」）。

## 一次対応

1. Actions の `synthetic` の失敗した run を開き、失敗したステップを特定する。
2. `resolve-target` が「フォールバック」と summary に出ていれば、リリースのイメージが引けていない（リリースが無い、または GHCR のイメージ名が `monitoring/target.yaml` と違う）。監視自体は HEAD のビルドで動いている。
3. 起動ステップ（`docker compose up`）の失敗は、ログ末尾の原因（Dockerfile のビルドエラー、ポート競合、ヘルスチェック不成立）を見る。**アプリ側の不具合が原因なら RB-002** を実施する（監視が正しく失敗を捉えている）。
4. 手動で再実行する: Actions の `Run workflow`（`workflow_dispatch`）。2 回続けて失敗するなら Issue（`incident`）を手で起票する。

## 切り分け

| 症状                                                                                                             | 疑う場所                                                             | 確認                                                                    | 対処                                                               |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `resolve-target` がフォールバック                                                                                | リリース未作成 / イメージ名の不一致                                  | `gh release list`、`monitoring/target.yaml` と `release.yml` の push 先 | 名前を合わせる。リリースが無ければ正常（フォールバックは仕様）     |
| イメージの pull 失敗（denied / not found）                                                                       | GHCR の権限・パッケージの公開設定                                    | `docker pull ghcr.io/…@sha256:…`（ログイン済み）                        | パッケージの可視性・`packages: read` を確認                        |
| compose のビルド失敗                                                                                             | main の HEAD のビルド不具合                                          | ログ                                                                    | 修正 PR。main が壊れているので最優先                               |
| Playwright の導入失敗                                                                                            | npm / ブラウザのダウンロード                                         | ログ                                                                    | 再実行。続けば `e2e/synthetic/package-lock.json` を確認            |
| `外形監視が 3 時間以上実行されていない`（watchdog の incident）、または実行が来ない（最後の成功から 2 時間以上） | GitHub の cron の遅延・無効化（60 日無活動で schedule が無効になる） | Actions の一覧                                                          | `workflow_dispatch` で手動実行。リポジトリに活動があれば有効に戻る |
| `alert` ジョブの失敗（Issue を作れない）                                                                         | `issues: write` の権限                                               | ログの 403                                                              | ワークフローの permissions を確認                                  |

## rollback

監視の設定・スクリプト・ワークフローを直前の変更前に戻す（監視の不具合は監視コードの変更が原因のことが多い）。

1. `git log --oneline -- monitoring scripts/monitoring .github/workflows/synthetic.yml` で最近の変更を見る。
2. 問題の変更を `git revert <commit>` で取り消す PR を作る（履歴を書き換えない）。レビュー（CODEOWNERS）を経てマージ。
3. 緊急時は `workflow_dispatch` で `synthetic.yml` を手動実行し、復旧を確認する。
4. アプリ側のイメージを戻す必要があるときは RB-002 の「rollback」（前のリリースのイメージ digest へ）。

## 連絡経路

- 一次: GitHub Issue（ラベル `incident`）。assignee は CODEOWNERS の既定の所有者（on-call ロール = maintainer）。
- 監視基盤自身の死活は `monitoring-watchdog.yml`（3 時間ごと）が見るが、これも GitHub の schedule で動くため、schedule 自体が止まる（60 日無活動での無効化・GitHub 側の障害）と一緒に止まる。そのときはメンテナが定期的に Actions を確認するしかない（残存リスク）。
- 監視が止まっている間は、メンテナが手動で `synthetic.yml` を実行して穴を埋める。ack 目標 24 時間以内（sev3 相当は 72 時間）。
- 還流: 監視の見逃しが起きたら `monitoring/fp-fn-log.md` に見逃し（false negative）として記録する。

## 訓練記録

未訓練。理由: Actions 上の障害（イメージ取得失敗・Playwright の導入失敗・cron の欠落）は手元では再現できない。`resolve-target` のフォールバックは手元で動作を確認した（リリースが無いため mode=fallback、`monitoring/drills/*/target.json`）。
`synthetic.yml` が main に入った後に、`force_fallback` と `drill` の手動実行で訓練し、ここに追記する。
