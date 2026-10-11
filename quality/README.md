# quality/ — 回帰運用の台帳

回帰テストを「何を・いつ・どの範囲で・誰が責任を持って」回すかを、コードとして管理する。
実行の入口は `.github/workflows/ci.yml`（PR・main）と `.github/workflows/nightly.yml`（日次・週次）、`release.yml`（リリース前）。

| ファイル                                     | 役割                                                                 | 保守する人                |
| -------------------------------------------- | -------------------------------------------------------------------- | ------------------------- |
| [impact-map.yaml](impact-map.yaml)           | 変更ファイル（パス glob）→ 機能 → 実行する TC-ID。PR 層の選択の根拠  | 変更を入れる人（PR 内で） |
| [journeys.yaml](journeys.yaml)               | 重要ユーザージャーニー J-01〜J-05 と、守るケース                     | QA 担当                   |
| [regression-suite.csv](regression-suite.csv) | 回帰スイート台帳（**生成物**。手で編集しない）。列は下の「台帳の列」 | `build-suite.mjs` が生成  |
| [flaky-ledger.yaml](flaky-ledger.yaml)       | 隔離中の不安定テスト（期限付き）。**空で開始**                       | 該当テストの owner        |
| [known-gaps.yaml](known-gaps.yaml)           | 自動化するはずで未実装のケース（期限付き）                           | QA リード                 |

## 回帰の層（いつ・何を回すか）

| 層           | トリガー                                   | 範囲                                                                                   | 実行するもの                                                   |
| ------------ | ------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| PR 層        | `pull_request`                             | 変更影響で選択 + `@smoke` 常時。マップに無いパスの変更があれば**全件にフォールバック** | lint・unit/api（選択）・契約・e2e（選択、全ブラウザ）・compose |
| main push 層 | `push`（main）                             | 全件                                                                                   | PR 層と同じジョブを全件で                                      |
| 日次         | `schedule` 毎日 UTC 18:00（`nightly.yml`） | 全件・全ブラウザ                                                                       | unit/api・e2e 4 project・compose                               |
| 週次         | `schedule` 日曜 UTC 20:00（`nightly.yml`） | 全件を **3 回**（unit/api は 3 周、e2e は `--repeat-each=3`）                          | 不安定さ（flaky）の検出                                        |
| リリース前   | タグ `v*.*.*` / 手動（`release.yml`）      | 全件 + compose + セキュリティ（+ 性能があれば）                                        | 失敗したらリリースしない                                       |

### 選択実行の考え方（リスクベース）

- `scripts/regression/select.mjs` が `git diff --name-only <base>...HEAD` から、impact-map の glob に当たったエントリの `case_ids` と smoke を選ぶ。
- **選択の根拠（`selection_reason`）と、外したことで検証されなくなるリスク（`excluded_risks`）を、実行のたびに summary と `regression-selection.json` に残す。**
- 次のときは選択せず**全件**を回す（安全側）: ① マップに当たらないパスがある ② 差分が空 ③ `full: true` のエントリ（CI・選択ロジック・依存ファイルの変更）。
- マップの陳腐化は `scripts/regression/impact-check.mjs` が CI で止める: 追跡ファイルが当たらない / どこからも選ばれない自動化ケースがある / 存在しない TC-ID を参照する。
- 各エントリには変更の種類 `change_kind`（`code` / `config` / `db` / `api` / `infra` / `docs`）を付ける（backend の store・migration は `db`、`backend/openapi.yaml` は `api`、compose・Dockerfile・CI・監視・性能の道具は `infra`）。全エントリで必須で、語彙は `impact-check` が検査する。選択結果（`regression-selection.json`）に、当たったエントリの `change_kinds` が載る。
- tier が `smoke` のケースは「PR 層」として扱う（PR のたびに必ず動く。`journeys.yaml` の冒頭にも書いた）。
- 選択ロジックそのものの漏れは、日次の全件回帰で検証する（`verify-selection.mjs`。全件で落ちたのに、直近の変更から選択されていなかったケースを `selection-audit.json` に残す）。

## 台帳の列（regression-suite.csv）

| 列                                                                             | 由来                                                                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `case_id` `requirement_ids` `perspective_ids` `automated` `manual_reason`      | `docs/data/cases.csv`                                                                     |
| `tier`（smoke / pr / daily / manual）                                          | `cases.csv` の priority と automation_layer、`impact-map.yaml` の `smoke_case_ids`        |
| `journey_id`                                                                   | `journeys.yaml`                                                                           |
| `defect_ids`                                                                   | `docs/data/defects.csv`                                                                   |
| `status`（active / quarantined / manual。**運用上の状態**）                    | `flaky-ledger.yaml`（隔離中か）と automation_layer                                        |
| `last_run_at`                                                                  | `docs/data/executions.csv` の、そのケースの最新の実施（`not_run` を除く）の `executed_at` |
| `last_run_ids`                                                                 | 同じ実施履歴の `run_ref`（新しい順に最大 3 件。`gh-run-<run id>`）                        |
| `environment`                                                                  | 最新の run の `environment`（project 名までに短縮。複数ならセミコロン区切り）             |
| `steps_hash`                                                                   | `cases.csv` の `action`（手順）の SHA-256 の先頭 12 桁。手順が変わると値が変わる          |
| `last_result`（pass / fail / blocked / skipped / not_run。**最新の実施結果**） | 最新の run の `status`（複数環境で 1 つでも fail なら fail）                              |

- 実施履歴（`executions.csv`）が無い、またはそのケースの実施が無ければ、`last_*` と `environment` は空、`last_result` は `not_run`。
- `executions.csv` や `cases.csv` が変わったら `build-suite.mjs` で再生成する（CI の `--check` が止める）。手順（`action`）を直したのに `steps_hash` を見ずに古い実施結果を信じない、という使い方を想定している。

## 健全性の閾値（health-trend）

`scripts/regression/health-trend.mjs` は、ワークフローごとの直近の実行履歴（成功率・連続失敗・所要時間 p95）を見て、閾値を超えたら失敗にする。

| 指標                          | 閾値                                                          | 根拠                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 成功率                        | 0.9 以上                                                      | 運用方針                                                                                                                |
| 連続失敗                      | 2 回まで                                                      | 運用方針                                                                                                                |
| 所要時間 p95（既定）          | **600 秒（10 分）**                                           | `docs/ai-context.yaml` の `maximum_feedback_minutes: 10` に合わせる。実測: ci.yml の成功 run は 2.4〜4.4 分（push・PR） |
| 所要時間 p95（`nightly.yml`） | **1800 秒（30 分）**（`per_workflow_p95_sec` で個別に上書き） | 全件回帰を全ブラウザで回す日次・週次（3 周）は、PR のフィードバックとは別物。dry-run でも 2.9〜5.7 分かかる             |

以前は p95 の上限が 1800 秒の 1 本で、宣言値（10 分）と食い違っていた。上限は「フィードバックの速さ」を守る値にそろえ、所要が長いのが前提の nightly だけを例外として明示した。

## flaky（不安定テスト）の運用ルール

1. **retry で隠さない。** Playwright は `retries: 0`。失敗は失敗として記録する（`ci-summary.json` の `retried_success` は常に 0 のはず。0 でなければ設定違反として扱う）。
2. **検出**: 同一 SHA・同一テストで pass と fail が混在したら flaky。週次の `--repeat-each=3` と、日次・PR の再実行で検出する（`scripts/regression/flaky-report.mjs`）。
3. **起票**: nightly が flaky を見つけたら、ラベル `flaky` の Issue を自動起票する（同名の open Issue があれば作らない）。
4. **隔離は期限付き**: 直せないときだけ `flaky-ledger.yaml` に `test_id / rate / cause / owner / since / expires_at` を書く。期限は **since から 30 日以内**。期限が切れると CI（docs-check の台帳検査）が失敗する。隔離中のテストも日次では実行し続ける。
5. **原因の分類**: タイミング依存 / データ共有 / 外部依存 / 環境差 / 本物の不具合（flaky と思ったら不具合だった）。本物の不具合なら `defect` Issue を起票し、修正 PR に回帰ケースを足す。
6. **ledger を空に保つ**のが目標。台帳の件数・期限切れ数は nightly の `flaky-report.json` に出る。

## 責任と SLA（automation-12 / regression-11）

| 事象                           | 一次対応               | 目安                                            |
| ------------------------------ | ---------------------- | ----------------------------------------------- |
| main の CI（`ci-result`）が赤  | 変更を入れた人         | 当日中に着手。1 営業日で修正または revert       |
| 日次の全件回帰が赤             | 該当ジャーニーの owner | 翌営業日中に原因を切り分け                      |
| `flaky` Issue                  | テストの owner         | 3 営業日で原因を分類。直せなければ隔離（30 日） |
| known-gaps の期限切れ          | QA リード              | 期限前にテストを足すか、理由付きで期限を更新    |
| impact-map / journeys の見直し | QA 担当                | 四半期ごと、またはリリース前                    |

## 保守・陳腐化管理

- 新しいファイルや機能を足す PR は impact-map も更新する（`impact-check` が落ちる）。
- 廃止した機能のケースは cases.csv で扱いを決めてから、journeys / impact-map から外す（stale な glob は `impact-check` が警告する）。
- `regression-suite.csv` は `node scripts/regression/build-suite.mjs` で再生成する（CI は `--check` でずれを検出）。

## ローカルでの実行

```sh
node scripts/regression/select.mjs --base origin/main          # いま変更しているファイルから選択結果を見る
node scripts/regression/impact-check.mjs                        # 影響マップの検査
node scripts/regression/build-suite.mjs --check                 # 回帰スイート台帳が最新か
node scripts/regression/flaky-report.mjs --validate-ledger      # flaky 台帳の形式・期限
node --test "scripts/test/*.test.mjs"                           # これらの道具自体のテスト
```
