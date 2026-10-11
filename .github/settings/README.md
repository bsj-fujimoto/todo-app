# .github/settings/ — リポジトリ設定のコード管理

リポジトリの統制（Ruleset・セキュリティ機能・Actions の権限など）を、GitHub の画面ではなく**ファイルで管理**する。
設定の「あるべき姿」はこのディレクトリ、「実態」は `gh api` の read-only スナップショットで確かめる。

| ファイル                    | 内容                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ruleset-main.json`         | `main` の Ruleset（PR 必須・承認・required checks・force push 禁止・削除禁止・linear history）         |
| `ruleset-release-tags.json` | リリースタグ `v*` の Ruleset（削除・更新・force を禁止。タグの作成は許す）                              |
| `repo-settings.json`        | squash のみ・マージ後ブランチ削除・secret scanning / push protection・Dependabot・PVR・Actions の権限・ラベル |

## main の Ruleset が要求すること

- **PR 必須**（直接 push 不可）。squash マージのみ。承認 1 件 + **code owner review**（`.github/CODEOWNERS`）。新しい push で古い承認は無効化（stale review dismiss）。レビュースレッドは解決済みであること。
- **required status checks**: **`ci-result`** と **`security-result`**（どちらも GitHub Actions が出すもの。`integration_id: 15368`）。`strict`（base の最新に追従していること）。
  個別のジョブ名は required にしない。集約ジョブが `needs` の全ジョブの success を要求する（skipped は成功扱いにしない）ので、ジョブを足してもこの設定は変えずに済む。
- **force push 禁止**（`non_fast_forward`）、**ブランチ削除禁止**（`deletion`）、**linear history**。
- 「最後の push を別の人が承認」（`require_last_push_approval`）は**要求しない**（承認者が 1 人しかいないため）。

### bypass について（正直に）

このリポジトリは**単独メンテナ運用**で、PR の作成者以外に承認できる人がいない。「承認 1 件 + code owner review」を満たせないため、
**リポジトリ管理者（Admin ロール）に限り `pull_request` モードで bypass できる**ようにしてある。

- `pull_request` モードの bypass は「PR を通してのみ」バイパスできる。**直接 push はできない**（force push・削除・直接コミットは bypass 対象外のまま禁止）。
- required status checks（`ci-result` / `security-result`）も bypass 対象になりうる点に注意。管理者が bypass して CI が赤のままマージしないこと（運用ルール）。
- bypass を使ったマージは、GitHub の監査ログ（Rulesets の Insights）に残る。使った理由は PR の説明に書く。
- 協力者が増えたら、`bypass_actors` を空にして、承認者を別の人にする（`ruleset-main.json` を直して再適用）。

## 適用手順（リポジトリの管理者が行う）

```sh
# 1. 差分の確認（何も変更しない）
scripts/ci/apply-settings.sh --dry-run
# 2. 差分を読んで問題なければ適用（差分のある項目だけを適用する。冪等）
scripts/ci/apply-settings.sh
# 3. 適用後の実態を保存して確かめる（read-only）
scripts/ci/snapshot-github.sh github-snapshot
```

**Ruleset を作る前に、`ci-result` と `security-result` が main で一度は成功している**こと（成功したことのない check を required にすると、PR が永久に待たされる）。
実態の確認（適用前後の差分）は `snapshot-github.sh` の出力（`rulesets.json`・`branch-protection.json`・`check-runs.json` など）を比べる。

`repo-settings.json` で有効にするもの: squash のみ・マージ後ブランチ削除・secret scanning と push protection・Dependabot alerts と security updates・
private vulnerability reporting・Actions の許可範囲（GitHub 製 + 明示した 5 つ）・**action の SHA 固定を GitHub 側でも強制**・workflow の既定権限は read・
フォーク PR は外部のコントリビュータ全員の承認が要る。Code Scanning は CodeQL を `security.yml` から SARIF アップロードする「高度な設定」で動かすため、簡易設定（default setup）は `not-configured`。

## 実態の確認（snapshot-github.sh）

`scripts/ci/snapshot-github.sh [出力先]` は、書き込み系の API を一切呼ばず、次を JSON で保存する（qc-analyzer の `ingest-github` が読む形式）:
`repo.json`・`rulesets.json`（+ `rulesets/<id>.json`）・`branch-protection.json`・`check-runs.json`・`workflows.json`・`runs.json`・`dependabot-alerts.json`・
`code-scanning-alerts.json`・`secret-scanning-alerts.json`・`audit-workflow.json`・`manifests.json`・`dependabot.yml`・`CODEOWNERS`・`workflows/*.yml`・`snapshot-meta.json`。
取得に失敗した API（403 / 404）は `{"__error__":{"http_status":…,"message":…}}` をそのファイルに保存する。**403 は「権限か契約か分からない」、404 は「機能が無効」であって、「問題なし」ではない。**
スナップショットは**作業ツリーの workflow・dependabot.yml・CODEOWNERS をコピーする**ので、main をチェックアウトした状態で実行する。
