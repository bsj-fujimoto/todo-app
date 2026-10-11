# ADR-0004: 単独メンテナ運用の統制（Ruleset・承認・bypass の扱いと限界）

- 状態: 採用（定義は 2026-10-11。**リポジトリへの適用は 2026-10-12 時点で未実施**）
- 決定者: プロダクトオーナー（リポジトリオーナーの指示。PR #20 のマージをもって承認。フェーズ1は AI が代行マージ）
- 関連: `.github/settings/ruleset-main.json`、`.github/settings/ruleset-release-tags.json`、`.github/settings/repo-settings.json`、`.github/settings/README.md`、`.github/CODEOWNERS`、`scripts/ci/apply-settings.sh`、`scripts/ci/snapshot-github.sh`、PR #20・#34

## 背景

本リポジトリは**単独のリポジトリオーナーと AI エージェント**で運用している。ロール（プロダクトオーナー・開発リード・QA リード・セキュリティ担当 ほか）は兼務で、不在時の代理は置けない。
GitHub の Ruleset で「PR 必須・承認 1 件・code owner review」を要求すると、**PR の作成者以外に承認できる人がいない**ため、承認の条件を誰も満たせない。
一方で、main を常にリリース可能に保つには、直接 push の禁止と CI の必須化は欲しい。

## 決定

`main` の Ruleset（`ruleset-main.json`、`enforcement: active`）で次を要求する。

| 規則 | 値 |
|---|---|
| PR 必須（直接 push 不可）、squash のみ | `allowed_merge_methods: [squash]` |
| 承認 | 1 件 + **code owner review**（`.github/CODEOWNERS`。`*`・`/docs/`・`/backend/openapi.yaml`・`/.github/` がオーナー） |
| 古い承認の扱い | 新しい push で無効化（`dismiss_stale_reviews_on_push`）。レビュースレッドは解決済みであること |
| required status checks | **`ci-result`** と **`security-result`**（`strict`）。個別ジョブは required にせず、集約ジョブが `needs` の全成功を要求する（skipped は成功扱いにしない） |
| 履歴 | force push 禁止（`non_fast_forward`）、削除禁止、linear history |
| 最後の push の別人承認 | **要求しない**（`require_last_push_approval: false`。承認者が 1 人しかいないため） |
| bypass | **リポジトリ管理者（Admin ロール）のみ、`pull_request` モードに限る**。PR を通してのみバイパスでき、直接 push・force push・削除は bypass できない |

運用ルール:

- bypass してマージするときは、**PR 本文に理由を書く**。管理者が CI の赤のまま bypass しない。
- フェーズ1の PR のマージは、オーナーの明示許可（2026-10-11）に基づき**AI が代行**する。したがって「承認」は「プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ）」と記録し、別の人の独立したレビューがあったとは書かない。
- 協力者が増えたら、`bypass_actors` を空にして承認者を別の人にし、`ruleset-main.json` を直して再適用する。
- 適用はオーナー（管理者）が `scripts/ci/apply-settings.sh --dry-run` → `scripts/ci/apply-settings.sh` で行い、`scripts/ci/snapshot-github.sh` で実態を保存して確かめる。**`ci-result` と `security-result` が main で一度は成功してから**適用する（成功したことのない check を required にすると PR が永久に待たされる）。

## 影響

- 良い点: 統制の「あるべき姿」をコードで管理し、差分と実態をスクリプトで確かめられる。bypass が PR 経由に限られ、直接 push で CI を飛ばせない。
- **限界（正直に）**:
  - **独立した第二の目が無い**。承認はオーナー（または代行する AI）自身の PR のマージで、承認者と作成者が同じになる。レビューで欠陥を見つける効果は、CI（lint・unit・api・e2e・contract・セキュリティ検査）と自己レビューに頼っている。
  - **bypass は required status checks も飛ばせる**。「CI が赤なら bypass しない」は運用ルールで、機械が止めるのではない。
  - 不在時の代理が置けない。オーナーが対応できない間は、PR のマージも、障害（外形監視の Issue、sev1 の ack 目標 24 時間）の対応も止まる（`monitoring/alert-routes.yaml`）。
  - **2026-10-12 時点で Ruleset はリポジトリに適用されていない**（`gh api repos/bsj-fujimoto/todo-app/rulesets` が空の配列を返す。ブランチ保護も 404）。したがって現在の main の保護は、定義どおりには**効いていない**。効いている設定は、squash のみ・マージ後ブランチ削除・secret scanning と push protection・Dependabot security updates（`gh api repos/bsj-fujimoto/todo-app` の値）。適用はオーナーの作業で、実施したらこの ADR の状態とスナップショット（`docs/evidence/github/`）を更新する。
  - 運用日数がまだ短い（4 日未満）ため、bypass の使用回数や統制の効果は評価できない。
- 検査: 統制の自動検査は `security.yml` の governance ジョブ（ワークフロー W1〜W10）と `scripts/ci/snapshot-github.sh`。実態の確認は適用後に行う。

## 却下した案

| 案 | 却下の理由 |
|---|---|
| 承認 0 件・CI だけを必須にする | 人の目を通す入口（PR とコメント）が残らない。code owner を定義しておけば、協力者が増えたときにそのまま効く |
| 承認 1 件を bypass なしで要求する | 承認できる人がおらず、誰もマージできなくなる |
| 管理者の bypass を `always`（直接 push も可）にする | 直接 push で CI を飛ばせる。`pull_request` モードなら PR と CI の記録が残る |
| 別アカウントを作って相互承認する | 実在する第二の人ではなく、形だけの承認になる。偽装なので採らない |
| required status checks に個別ジョブを列挙する | ジョブを足すたびに設定の変更が要る。集約ジョブ（`ci-result`・`security-result`）なら設定は変わらない |
