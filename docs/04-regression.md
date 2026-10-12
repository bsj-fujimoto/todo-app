# 04 リグレッションテスト成果物

| 項目 | 内容 |
|---|---|
| 文書ID | DOC-04 |
| 版 | 1.1 |
| 更新日 | 2026-10-12 |
| 状態 | draft（オーナーの確認待ち。PR マージ＝承認の代行） |
| 対象 | todo-app 仕様書 v1.1（spec/todo-phase1-spec.html）、リリース v1.0.0（commit 5fcf40a7e58dc253e53ff56860d0669a69abda26） |
| 作成 | QA 担当（ロール。実作業は AI エージェント） |
| レビュー | QA リード（未実施。作成者と別ロールだが兼務で、第二の目は無い） |
| 承認 | プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ。オーナーの確認が済むまで draft のまま） |
| 正本 | この md と、[quality/](../quality/README.md)（`impact-map.yaml`・`journeys.yaml`・`regression-suite.csv`・`flaky-ledger.yaml`・`known-gaps.yaml`）、`.github/workflows/`（`ci.yml`・`nightly.yml`・`release.yml`）、`scripts/regression/`、`docs/data/cases.csv`（Git が版管理） |

本書は、**変更が入っても、これまで動いていたものが壊れていないこと**を、変更の影響とリスクに応じて機械で確かめる仕組みの**方針・実績・できていないこと**をまとめる。
設定そのもの（変更影響マップ・ジャーニー・スイート台帳・flaky 台帳）は `quality/` が正本で、ケースの行は `docs/data/cases.csv`、実施の行は `docs/data/executions.csv` が正本である。本書は読み方と判断を書く（二重管理しない）。
**数字はすべて出典（パス・Issue・PR・run）を付けた。** run の件数は 2026-10-11 16:12 UTC（= 2026-10-12 01:12 JST）に、実施表・不具合表・回帰スイート台帳・影響マップの件数は 2026-10-12 に main（c14d39a）の現物から数え直した。時間とともに変わる値は出典で数え直す。

実施表・不具合表（`docs/data/executions.csv`・`defects.csv`）は、v1.0.0 の run（Release run 38152472087）から再生成され、**PR #42 が 2026-10-11T16:30:20Z に main へマージ済み**である。**本書の実施・不具合の数字は、main の CSV から数え直した値**（実施表 111 行はすべて `gh-run-38152472087`・commit 5fcf40a…）で、`docs/evidence/runs/38152472087/` も main にある。旧 run（38128562945、対象 52da4aa）の証跡は `superseded` の印を付けて履歴として残している（[scripts/evidence/README.md](../scripts/evidence/README.md)）。

## 結論

- **スイート**: 回帰スイート台帳 `quality/regression-suite.csv` は 77 行（smoke 5・pr 67・daily 3・manual 2）。自動 75 件（97.4%）・手動 2 件（TC-071・TC-072、**未実施**）。全行が要求・観点に紐づく（77/77）。
- **変更影響マップ**: `quality/impact-map.yaml` はエントリ 32 件（うち 4 件は「全件にフォールバック」）と「テストに影響しない」3 件。追跡ファイル 1,077 件のうち、どこにも当たらないものは 0（`impact-check.mjs` を 2026-10-12 に手元で実行、PASS）。
- **重要ジャーニー**: J-01〜J-05 の **5 件すべて**に、PR 層（pr または smoke）の自動ケースがある（37 ケース。最新の全件回帰で 37 ケースとも pass）。
- **層**: PR（変更影響で選択）・main push（全件）・日次・週次（全件 ×3）・リリース前（全件 + compose + セキュリティ）。**日次・週次の定期実行（schedule）は、2026-10-11 16:12 UTC の時点では 0 回だったが、その後に始まった**（日次 1 回・週次 1 回。成功。下記。実績はまだ短い）。
- **選択実行の実績**: ci.yml が完了した 55 run（PR 42・main push 13。いずれも 2026-10-11）のうち、PR の 8 run が選択実行（5〜52 ケース）、残りは全件。各 run に選定理由と「外したことで検証されないリスク」が記録されている。
- **欠陥の再発防止**: 修正済みの欠陥 7 件（DEF-005・006・011・015・016・036・037）の**すべて**に再現ケースがあり、回帰スイートに入っている。
- **flaky**: Playwright の `retries` は 0。再試行で成功した例は 0（`retried_success` 0）。隔離台帳は 2 件（TC-073・TC-074、期限 2026-11-10）。
- **できていないこと（正直に）**:
  - **運用期間がまだ短い**。run はすべて 2026-10-11 の約 9 時間（06:50〜16:09 UTC）に集中し、4 週間に満たない。**日次（`schedule`）・週次の実行は、数えた時点（16:12 UTC）では 0 回**だった。その後、日次 1 回・週次 1 回が成功した（下記）が、傾向、flaky の週次検出の積み上げ、選択ロジックの定期検証は、実績が足りない（regression-06・11・13）。
  - **データ・スキーマの移行と切り戻しを、実際に流して確かめたことは無い**。v1.0.0 のスキーマは 1 版しか無く、移行が 1 度も起きていない。方針とフェーズ2での検証計画を書いた（regression-14）。
  - 実機の 2 ケース（TC-071・TC-072）は未実施（期限 2026-10-31、`docs/evidence/manual-plan.yaml`）。
  - 版の組み合わせ互換（regression-15）は**承認済みの対象外**（理由・承認・見直し日を本章に書いた。承認は PR のマージ＝代行で、オーナーの確認は未実施）。
  - 単独のリポジトリオーナー + AI エージェントの体制で、第二の目・不在時の代理は置けない。

## regression-01 目的・適用範囲

**結論**: 守るのは「フェーズ1（v1.0.0）で動いている機能と、その保存データ」。PR・main への push・日次・週次・リリース前のそれぞれで、**どの範囲を回すか**（選択するか全件か）の基準を決めてある。

**目的（purpose）**

変更が入るたびに、次を壊していないことを機械で確かめる。

- 受け入れ条件 AC-01〜AC-07 と、必須ケース 66 件（`docs/data/cases.csv` の `mandatory=必須`。[03 の 2 章](03-test-spec.md)）。
- high のリスク 3 件（RISK-001 データ損失、RISK-003 保存失敗時の画面と保存の乖離、RISK-004 破損データの自動上書き）に紐づく 36 ケース（RISK-001 が 12・RISK-003 が 20・RISK-004 が 4。複数のリスクに紐づくケースを含むので、ケース数は重複を除くと 31）。
- API 契約（`backend/openapi.yaml`）と、docker compose の一式起動。

**守る資産（assets）**

| 守るもの | 具体的な対象 | ケース・検査 | 正本 |
|---|---|---|---|
| 重要ジャーニー | J-01〜J-05（追加して再読込しても残る／完了切替／削除／不正入力の拒否／保存失敗・破損からの保護） | 37 ケース | [quality/journeys.yaml](../quality/journeys.yaml) |
| 保存データ | SQLite の tasks と、compose のボリューム `todo-data`。再起動・失敗・破損で失われない／上書きされない | TC-041〜TC-044、TC-050〜TC-055 など | [03 の 10 章](03-test-spec.md) |
| API 契約 | 5 operation の入出力・エラー封筒・検証順 | contract 8 件 + oasdiff（破壊的変更の検出）+ redocly lint | `backend/openapi.yaml`、`scripts/ci/oasdiff-breaking.sh` |
| 画面 | 入力検証・状態遷移・画面状態・a11y・360px・3 ブラウザ | e2e 43 実行（4 project） | [03 の 13 章](03-test-spec.md) |
| 起動・配信 | docker compose の起動、nginx の中継、ヘルス | compose 4 件、smoke（TC-075・TC-076） | `e2e/compose/stack.spec.js` |

**実行の契機と範囲（trigger_scope）— 選択と全件の使い分け基準**

| 契機 | 範囲 | 選択の基準 |
|---|---|---|
| PR（`pull_request`） | **変更影響で選択** + `@smoke` 5 件を常時 | 変更ファイルが `impact-map.yaml` の glob に当たったエントリの `case_ids` の和集合 + smoke（TC-001・TC-030・TC-056・TC-075・TC-076） |
| main への push | **全件** | 選択しない。PR で外したケースを、マージのたびに必ず回す |
| 日次・週次（`nightly.yml`） | 全件（週次は全件 ×3） | 選択しない。選択ロジックの漏れの検証も兼ねる（regression-13） |
| リリース前（`release.yml`） | 全件 + compose + セキュリティ + 証跡検査 | 選択しない。失敗したらリリースしない |

次のときは、PR でも**選択せず全件に倒す**（安全側。`scripts/regression/select.mjs`）。

1. マップに当たらないパスが 1 つでもある。
2. 差分が空。
3. `full: true` のエントリに当たる（CI・選択ロジック・依存ファイル・共有基盤の変更）。該当は 4 エントリ: `backend-test-infra`、`frontend-package`、`e2e-shared`、`ci-pipeline`。

**適用の実績**: ci.yml の PR run 42 件のうち、選択実行は 8 件（19%）、全件は 34 件。全件が多いのは、この期間の PR の多くが CI・選択ロジック自体（`ci-pipeline`）を変えるものだったため（例: run 38139660319 の選択理由は「全件実行を要求するエントリに該当: ci-pipeline」）。

## regression-02 変更影響マッピング

**結論**: コード・設定・DB（保存層）・API 契約・テストの変更から、影響する機能と実行するケースへ、`quality/impact-map.yaml` でたどれる。マップは**自動生成ではなく、変更を入れる PR の中で人が更新**し、**更新漏れは CI（`impact-check.mjs`）が止める**。

**マップの中身**（[quality/impact-map.yaml](../quality/impact-map.yaml)）

| 項目 | 値 |
|---|---|
| エントリ数 | 32（機能・層ごと。パスの glob → 機能 → `case_ids` → `excluded_risk`） |
| 全件にフォールバックするエントリ | 4（共有基盤・依存・CI は影響を絞れないため） |
| テストに影響しない変更 | 3（docs・spec・リポジトリのメタ情報。smoke だけ回す） |
| 常時実行（smoke） | 5 ケース |

**変更の種類ごとの追跡**

各エントリは `change_kind`（code・config・db・api・infra・docs）を持つ（PR #57。`impact-check.mjs` が語彙を検査し、`select.mjs` の出力に `change_kinds` が出る）。32 エントリの内訳は code 21・infra 5・config 4・api 1・db 1。

| 変更の種類 | 当たるエントリの例 | 影響する機能 | 実行するケース（抜粋） |
|---|---|---|---|
| API 契約 | `api-contract`（`backend/openapi.yaml`） | 5 operation の入出力・エラー | 契約・検証・保存失敗の 22 ケース |
| DB・保存層（マイグレーション含む） | `backend-storage`（`backend/src/store/**` と保存系のテスト） | 永続化・破損・書込み失敗・並び順・並行 | TC-001、TC-038〜TC-055 など 23 ケース |
| ドメイン・検証 | `backend-domain`、`backend-validation`、`frontend-validation` | 採番・既定値・タイトル検証 | TC-002〜TC-007、TC-016〜TC-036 など |
| 画面 | `frontend-view`、`frontend-logic` | 描画・状態管理・API クライアント | 画面系 39〜48 ケース |
| 配信・構成（設定） | `serving-compose`（nginx・Dockerfile・compose） | 起動・中継・ボリューム | TC-001、TC-041〜TC-045、TC-075〜TC-077 など 13 ケース |
| CI・依存・共有基盤 | `ci-pipeline` ほか 3 件（`full: true`） | すべて | **全件** |

**当たり率の検査と実績**

- `impact-check.mjs` は、**追跡ファイルのすべてがどこかのエントリに当たる**こと、**自動化ケースのすべてがどこかから選ばれる**こと、存在しない TC-ID を参照していないことを CI の docs-check ジョブで検査する。2026-10-12 の手元実行は、追跡ファイル 1,077 件（`docs/evidence/` の取り込みで増えた）・当たらない 0・どこからも選ばれないケース 0・古い glob の警告 2（`.gitleaks*`、`LICENSE` の glob に当たるファイルが無い）。
- **マップの陳腐化を CI が止めた実績が 3 回**ある（ci.yml の run 38126691020、38138793218、38139049588。いずれも docs-check の「変更影響マップが追跡ファイルと合っている」で失敗し、同じ PR の中で直した）。
- 選択実行 8 run の選択ケース数は 5〜52 件。例: タイトル検証だけを変えた PR（run 38123870254）は `backend/src/domain/title.js → backend-validation` に当たり 34 ケース、docs だけを変えた PR（run 38153359104）は smoke の 5 ケースだけ。
- 限界: マップを書くのは人なので、書き漏れ（影響があるのに当たらない）は `impact-check` では検出できない。この種の漏れは、全件回帰で落ちたケースが選択から外れていたかを突き合わせる `verify-selection.mjs`（regression-13）で見つける設計だが、**定期実行での検証記録はまだ無い**。

## regression-03 重要ユーザージャーニー

**結論**: 重要ジャーニー 5 件（J-01〜J-05）の**すべて**に、PR 層の自動ケースがある。最新の全件回帰（Release run 38152472087）では、5 件 37 ケースの実施 53 行（環境違いを含む）がすべて pass。

PR 層の「常時」の意味を正確に書く。**毎回の PR で必ず動くのは smoke の 5 ケース（J-01 の TC-001 を含む）だけ**で、J-02〜J-05 のケースは、関連するパスを変更した PR では選択され、そうでない PR では**main への push（全件）**で保護される。日次（schedule）は定義済みだが実績が無い（regression-06）。

| ジャーニー | 内容 | 担当 | ケース数 | 層の構成（tier / 実装の層） | 失敗時の対応（`journeys.yaml` の `on_failure`） |
|---|---|---|---|---|---|
| J-01 | タスクを追加して再読込しても残る | バックエンド担当 | 5 | smoke 1・pr 4 / e2e 4・api 1 | main へのマージを止める（`ci-result`）。保存層が原因なら RISK-001 の defect Issue を起票し、修正 PR に回帰ケースを足す |
| J-02 | 完了を切り替えると表示と保存データの両方に反映される | フロントエンド担当 | 4 | pr 4 / e2e 3・api 1 | main へのマージを止める。状態遷移表（[03 の 8.2](03-test-spec.md)）と照合して defect Issue を起票 |
| J-03 | タスクを削除すると一覧と保存データから消え、他のタスクは変わらない | バックエンド担当 | 6 | pr 6 / api 3・e2e 3 | main へのマージを止める。削除対象の取り違えは high として扱う |
| J-04 | 不正入力が弾かれ、保存データが変わらない | フロントエンド担当 | 13 | pr 13 / api 7・unit 4・e2e 2 | main へのマージを止める。検証規則の差は `openapi.yaml` の TitleInvalid を正として直す |
| J-05 | 保存に失敗しても・保存データが壊れていても、データを守る | バックエンド担当 | 12 | pr 12 / e2e 7・api 5 | main へのマージを止める。**リリース前層でも必ず実行**し、失敗したらリリースしない |

（ケース数の合計 40 は、複数のジャーニーに属するケース 3 件を重複して数えたもの。重複を除くと 37 ケース。出典: `quality/regression-suite.csv` の `journey_id`、`docs/data/cases.csv`、`docs/data/executions.csv`）

- 守る対象の根拠: ジャーニーごとに「なぜ止められないか」（`why`）を `journeys.yaml` に書き、リスク（RISK-001・RISK-002・RISK-003・RISK-004）に結びつけている（[docs/ai-context.yaml](ai-context.yaml) の `user_journeys`）。
- 失敗時の対応: 一次対応の担当・期限は、[quality/README.md](../quality/README.md) の「責任と SLA」（main の CI が赤なら当日着手・1 営業日で修正か revert。日次の全件回帰が赤なら該当ジャーニーの担当が翌営業日中に切り分け）。**担当は兼務で、不在時の代理は置けない**（制約）。
- 外形監視（本番相当の確認）側でも J-01〜J-05 を守っている（[11 外形監視・運用品質成果物](11-monitoring.md)）。回帰が通っても監視が落ちる、またはその逆が起きたときは、回帰のケースを足す（#36 の例が regression-07）。

## regression-04 リスクベース選定

**結論**: 全件か選択かは**リスクと変更影響**で決める。選択するのは PR 層だけで、**選んだ理由（selection_reason）と、外したことで検証されなくなるリスク（excluded_risk）を、PR の run ごとに summary と artifact に残す**。外したケースは main への push の全件回帰で必ず回す。

**選定の根拠（selection_rationale）**

1. 変更ファイル（`git diff --name-only <base>...<head>`）を `impact-map.yaml` の glob に当て、当たったエントリの `case_ids` の和集合に smoke 5 件を足す。
2. マップに当たらないパス・`full: true` のエントリ・差分が空のときは、**選ばずに全件**（regression-01）。
3. 迷ったら広く書く（選びすぎは安全、外しすぎは漏れ）。エントリごとに、そのエントリだけで選んだときに検証されなくなるもの（`excluded_risk`）を書く。

実際の run の例（`regression-selection` artifact。90 日保持）:

| run | 変更 | モード | 選んだ理由 | 外したことで検証されないリスク（抜粋） |
|---|---|---|---|---|
| 38123870254 | `backend/src/domain/title.js` | 選択 34 ケース | `backend-validation` + smoke | RISK-004（除外 4/4）、RISK-013（除外 8/8）、RISK-001（除外 11/12）。保存層・画面表示・保存失敗の扱い |
| 38140398253 | backend のテスト 3 本と cases.csv・datasets.csv | 選択 52 ケース | `backend-storage`・`backend-health`・`backend-tests`・`docs` + smoke | RISK-007（除外 9/9）、RISK-002（除外 9/23）。入力検証・画面の見た目・ブラウザ差 |
| 38153359104 | `docs/README.md`・`docs/ai-context.yaml` | 選択 5 ケース（smoke のみ） | `docs`（テストに影響しない変更） + smoke | ほぼ全リスク（RISK-001 除外 11/12 など）。アプリのコードを変えていないので受容 |
| 38139660319 | `.github/workflows/` など | 全件 | `ci-pipeline`（全件を要求するエントリ） | なし（全件） |

**除外リスク（excluded_risk）の扱い**

- 開示: 上の表のとおり、リスクごとに「除外 n/m」（そのリスクに紐づくケース m 件のうち n 件を外した）を毎回出す。
- 受容: 「PR で外したケースは main への push の全件回帰で検証する」という**方針**を、本書のマージ（プロダクトオーナーの承認）をもって受容する。run ごとの個別の受容記録は取らない（取っているのは開示まで）。受容が成り立つ前提は、**main への push で全件が必ず走る**こと。push の run は 13 件すべて全件実行だった（例: run 38153550607）。
- 残る穴: マップの書き漏れで外れたケースは、全件で落ちたときに初めて分かる。この漏れの検証は regression-13。

**フル回帰による検証（full_verification）**: main への push 13 run（成功 12・失敗 1）が全件。失敗の 1 件は run 38140205187（TC-074 の性能しきい値の揺れ。#37 → [ADR-0005](adr/0005-functional-layer-perf-sentinel.md)）で、選択から外れたケースの見逃しではない。日次の選択ロジック検証は regression-13。

## regression-05 スイートのトレーサビリティ

**結論**: 回帰スイートの 77 行は、すべて要求・観点・実施履歴に紐づく。欠陥への紐づきは、欠陥があったケース（11 行）だけである。

| 紐づき | 件数 | 出典 |
|---|---|---|
| 要求（REQ）または観点（VIEW） | 77 / 77 | `quality/regression-suite.csv`の `requirement_ids`・`perspective_ids` |
| 実施履歴（EXEC） | 77 / 77（EXEC 111 行。pass 109・not_run 2。すべて run 38152472087 の commit 5fcf40a…） | `docs/data/executions.csv` |
| 欠陥（DEF） | 11 行（TC-008・020・031・046・050・061・063・073・074・075・076） | `quality/regression-suite.csv` の `defect_ids`（`docs/data/defects.csv` から生成） |
| ジャーニー（J-xx） | 37 / 77 | `quality/journeys.yaml` |
| リスク（RISK） | 77 / 77（`cases.csv` の `risk_ids`） | `docs/data/cases.csv` |

- **1 行で結ぶ表**: [docs/data/traceability.csv](data/traceability.csv)（要求・リスク・観点・ケース・実施・欠陥・検出・アクションを 1 行に並べる）。連鎖は REQ → RISK → VIEW → TC → EXEC → DEF（[docs/README.md](README.md)）。
- **台帳は生成物**: `regression-suite.csv` は `node scripts/regression/build-suite.mjs` が `cases.csv`・`journeys.yaml`・`flaky-ledger.yaml`・`defects.csv` から作る。手で編集せず、CI が `--check` で再生成漏れを止める。
- 欠陥のないケースの方が多いのは自然（77 行中 66 行）。欠陥に紐づかないことを「紐づけ漏れ」とは読まない。**「全ケースが欠陥に紐づく」状態は目指さない**（欠陥のないケースに欠陥を作らない）。
- 実行履歴の列: 台帳 `regression-suite.csv` は、PR #57 から**最後の実行**の列（`last_run_at`・`last_run_ids`・`environment`・`steps_hash`・`last_result`）を持つ（`executions.csv` から生成。`status` は active・manual・quarantined の運用上の状態のまま）。全履歴（ケース × 環境で 1 行）の正本は引き続き `executions.csv` で、台帳の列は最後の 1 回の要約（現在は 77 行すべてが run 38152472087、`last_result` は pass 75・not_run 2）。以前の「台帳に実行履歴の列が無い」「`regression-suite.csv` の再生成が必要」という状態は解消した。

## regression-06 実行レイヤー・頻度

**結論**: 5 つの層（PR・main push・日次・週次・リリース前）を使い分け、全件を回す層は 4 つ。ただし**日次と週次は、定期実行（`schedule`）の実績が短く**（数えた 16:12 UTC の時点で 0 回、その後に各 1 回）、層の見直し基準は方針として書いた段階にある。

| 層 | トリガー（定義） | 範囲 | 直近の実行（run ID・日付・結果） | 所要 |
|---|---|---|---|---|
| PR | `ci.yml` の `pull_request` | 変更影響で選択 + smoke。マップ外・共有基盤は全件 | run 38153533381（2026-10-11、選択 5 ケース、success）。run 38140398253（選択 52 ケース、success） | 145 秒・152 秒 |
| main push | `ci.yml` の `push`（main） | 全件 | run 38153550607（2026-10-11、全件、success）。13 run 中 12 成功・1 失敗（38140205187。#37） | 170 秒 |
| 日次 | `nightly.yml` の `schedule` 毎日 UTC 18:00 | 全件・全ブラウザ（e2e 4 project）・compose | **schedule の実績は 1 回**（run 38176336541、2026-10-11 21:25 UTC に起動。定義の 18:00 UTC から約 3 時間 26 分遅れ。成功。所要 約 3 分。数えた 16:12 UTC の時点では 0 回だった）。ほかに動作確認として、`nightly.yml` を変えた PR で同じジョブを動かした run 38130390783（2026-10-11、tier=daily、全件 75 ケース、success。Issue は起票しない） | 168 秒 |
| 週次 | `nightly.yml` の `schedule` 日曜 UTC 20:00 | 全件を 3 回（unit/api は 3 周、e2e と compose は `--repeat-each=3`） | **schedule の実績は 1 回**（run 38183878218、2026-10-11 23:20 UTC に起動。定義の 20:00 UTC から約 3 時間 20 分遅れ。成功。所要 約 3 分。数えた 16:12 UTC の時点では 0 回）。手動実行〔workflow_dispatch〕は未実施 | — |
| リリース前 | `release.yml` のタグ `v*.*.*` / 手動 | 全件（ci.yml を再利用）+ compose + セキュリティ + 証跡検査 | run 38152472087（2026-10-11、タグ v1.0.0、success。compose 4・contract 8・e2e 43・unit 143・api 74 がすべて pass）。dry-run の PR 検証は run 38130391032 ほか | 215 秒 |

- 最初の `schedule` の起動は、定義では日次が 2026-10-11 18:00 UTC、週次が同日 20:00 UTC（日曜）。実際は、日次が 21:25 UTC（run 38176336541）、週次が 23:20 UTC（run 38183878218）に起動し、**どちらも定義の時刻から 3 時間以上遅れた**（GitHub の schedule の遅延。外形監視の schedule も同様に遅延・欠落している。[11 の monitoring-06](11-monitoring.md)）。本表の「実績 0 回」は run ID に更新した。
- 手動の臨時フル回帰（`workflow_dispatch` の `tier=full`）もある。

**層の見直し基準（方針。実績に基づく見直しはまだ行っていない）**

| 見直しのきっかけ | 基準 | 対処 |
|---|---|---|
| PR のフィードバック時間 | 成功 run の p95 が 10 分（宣言値。[ai-context.yaml](ai-context.yaml) の `maximum_feedback_minutes`）を超える。現在の p95 は 234 秒（[05 の automation-09](05-automation.md)） | PR 層の選択を増やす、またはジョブを分割・並列化する |
| 全件回帰の時間 | 日次の全件（`nightly.yml`）の所要の p95 が 30 分を超える（`health-trend.mjs` の `per_workflow_p95_sec` で `nightly.yml` だけ 1800 秒。PR のフィードバックの上限は既定の 600 秒） | 全件を週次に寄せ、日次を選択にする |
| 選択ロジックの漏れ | `selection-audit.json` に `leak_detected` が 1 件でも出る | マップを直し、同じ PR で該当ケースを追加する。PR 層の範囲を見直す |
| 周期的な棚卸し | 四半期ごと、またはリリース前（[quality/README.md](../quality/README.md)） | 層の割り当て（`tier`）・ジャーニー・マップを見直す |

## regression-07 不具合再発防止

**結論**: 修正済みの欠陥 **7 件すべて**に、再現ケースが回帰スイートに入っている（7/7）。直した条件の周辺（同じ原因クラスの別の入口）にも、ケースを足している。リリース後の欠陥は 0 件だが、本番環境が無く運用日数も短い（4 日未満）ので、「本番へ流出した欠陥を回帰へ戻す」実績は無い。

**再現ケース（reproduction_case）・回帰スイートへの組み込み（in_suite）・同系統条件への展開（generalized）**

| 欠陥（Issue） | 内容 | 再現ケース（層・tier） | 同系統条件への展開 | 修正（PR・commit） |
|---|---|---|---|---|
| DEF-005（#5、major） | 書込み不可で開いた SQLite 接続が、権限を戻しても書込み不可のまま | TC-050（api・pr） | TC-051（完了切替・削除も 503 で行が部分的にも変わらない）。補助テスト: 読み取りは書込み不可でも成功し、権限を戻せば**再起動なしで**更新できる | bfebaee |
| DEF-006（#6、major） | 追加の送信中に打った次の入力が、先の追加の成功で消える | TC-061（e2e・pr。frontend の単体に「Issue #6 の回帰」を追加）、TC-063（連打）、TC-020（同名の 2 連続追加） | 送信中の入力（A → B）、連打 5 回で POST が 1 回、通信中の別の行の操作を妨げない、まで広げた | 72243c4 |
| DEF-011（#11、minor） | 完了切替の通信中にチェックボックスが反転して見える | TC-008・TC-046（e2e・pr。frontend の単体にも） | 通信中の行の表示（描画関数の単体）、連打は 1 回だけ送る、別の行の操作は妨げない、保存失敗後もチェックは変わらない | c3a6e84（PR #12） |
| DEF-015（#15、minor） | 本文サイズ超過の応答が TCP の RST で失われ、テストが不安定 | TC-031（api・pr）と補助テスト（`backend/test/api/robustness.test.js`） | fetch・`Connection: close`・chunked の 3 種 × 3 MiB × 各 20 回。宣言された長さが上限超の場合。**修正を外すと 3 種とも毎回失敗することを確認**（修正前は 12 回中 6 回失敗） | 6fb219a（PR #21） |
| DEF-016（#16、minor） | compose の環境変数がイメージの COMMIT_SHA を上書きし、health の commit が unknown | TC-075（api・smoke）、TC-076（e2e・smoke） | smoke に入っているので、**すべての PR で動く**。rollback の再訓練（2026-10-11 12:20 UTC）でも確認 | fd2b322（PR #19） |
| DEF-036（#36、minor） | 製品の挙動修正（PR #12）に外形監視のジャーニーが追随せず、MON-008 が誤検知 | TC-008（e2e・pr）と外形監視（`e2e/synthetic/journey.spec.js`） | PR テンプレートに「画面・API の振る舞いを変えたら外形監視の期待を確認する」を追加 | 5fcf40a（PR #39） |
| DEF-037（#37、minor） | 共有ランナーの負荷で TC-074 の絶対時間しきい値が揺れた | TC-074（e2e・daily）。TC-073（api・daily）も同じ扱い | 機能層は桁違いの劣化を見つける番兵（CI はしきい値 3 倍）、SLO の本判定は perf 層、と層の役割を分けた（[ADR-0005](adr/0005-functional-layer-perf-sentinel.md)）。同種の TC-073 も同じ方針（#25） | 1abf247（PR #38） |

（出典: `docs/data/defects.csv`〔main。修正済み 7・未修正 3＝DEF-025・031・033〕、各 Issue、`quality/regression-suite.csv`。未修正の DEF-025 は TC-073、DEF-031 は TC-073・TC-074 に紐づく。DEF-033 は受容の追跡でケースを持たない。）

- 欠陥を直す PR の規則（運用）: ① 再現を**失敗する形**で先に確かめる、② 同じ原因クラス（`cause_class`）の別の入口へケースを広げる、③ `cases.csv` に TC を足し、`regression-suite.csv` を再生成する（CI が `--check` で再生成漏れを止める）、④ 修正を外すと落ちることを確認する（DEF-015 の PR #21 が実例）。
- **台帳への反映**: `regression-suite.csv` の `defect_ids` は `defects.csv` から生成する。PR #57 の再生成で、DEF-036（TC-008）・DEF-037（TC-073・TC-074）も反映済みで、台帳の時差は解消した（`build-suite.mjs --check` が 2026-10-12 に最新と確認）。実施表や不具合表を更新したら `node scripts/regression/build-suite.mjs` で再生成する（CI の `--check` が再生成漏れを止める）。
- 欠陥ゼロの条件で足したケース: なし（欠陥のない条件にケースを作ることはしていない）。

## regression-08 環境・データ

**結論**: 回帰は**使い捨ての環境**で回す。環境は固定（OS・Node・ブラウザ・依存の版）し、各テストが専用のスタックとデータを作って後始末する。回帰専用の長期環境（ステージング）は無い。

**安定環境（stable_env）**

| 項目 | 固定のしかた | 出典 |
|---|---|---|
| 実行基盤 | GitHub-hosted runner `ubuntu-24.04`。Node は mise.toml と同じ 24 | `.github/workflows/ci.yml`、`mise.toml` |
| 依存 | `package-lock.json` を `npm ci`。action は SHA 固定。ツールのイメージは digest 固定 | `.github/actions/setup-node-npm/action.yml`、[ADR-0002](adr/0002-test-and-quality-toolchain.md) |
| ブラウザ | Playwright 1.64.0。chromium・firefox・webkit と 360px のモバイル | `e2e/playwright.config.js`、`e2e/package.json` |
| 実施環境の記録 | 実施ごとに、ブラウザの版・解像度・OS・Node の版を実施表に残す（例: chromium 156.0.8078.4 / 1280x800 / Linux 6.17.0-1022-azure / Node v24.21.0） | `docs/data/executions.csv` の `environment` |

**代表データ（representative_data）**: データセット 12 件（DS-001〜DS-012。空 DB・標準 3 件・タイトル境界値・同時刻・悪意ある文字列・1,000 件・破損 DB・書込み不可・不正リクエスト・クライアント条件・compose・障害注入）。生成方法・匿名化・初期化・担当を `docs/data/datasets.csv` に持つ（[03 の 6 章](03-test-spec.md)）。合成データのみで、個人情報を含まない。

**初期化（reset）**

- api・e2e: テストごとに専用の一時ディレクトリ・専用の SQLite・空きポート（`PORT=0`）を作り、`afterEach` / `finally` で削除する（`backend/test-support/sandbox.js`、`e2e/fixtures/stack.js`）。読取専用（`chmod 0444`）のままでも、権限を戻してから削除する。
- compose: 専用のプロジェクト名とボリュームで起動し、各テストの前後に `down -v` する（`e2e/compose/stack.spec.js`）。直列（workers=1）で、他の環境と衝突しない。
- 実行順を入れ替えても、もう一度実行しても同じ結果になる（[03 の 12 章](03-test-spec.md)）。

**揺らぎの記録と対処**

| 揺らぎ | 記録 | 対処 |
|---|---|---|
| 共有ランナーの負荷で、絶対時間のしきい値が揺れた（TC-073 の追加 p95 が 452.0ms、TC-074 の追加が 1054ms） | Issue #25（run 38123866985）、#37（run 38140205187）、`quality/flaky-ledger.yaml` | CI のしきい値を 3 倍にして番兵化、本判定は perf 層（[ADR-0005](adr/0005-functional-layer-perf-sentinel.md)）。台帳で隔離（期限 2026-11-10） |
| 初回の CI で Playwright のブラウザ導入などが失敗した | run 38119375067（初回のパイプライン構築） | ブラウザのキャッシュと `install-deps` の分岐を `ci.yml` に入れた |
| macOS の開発機では Firefox が動かない | [ADR-0002](adr/0002-test-and-quality-toolchain.md)、[01 の plan-07](01-test-plan.md) | 3 ブラウザの確認は Linux の CI で行う。開発機だけでは完結しない |

- 限界: 揺らぎの記録は、2026-10-11 の 1 日分。環境差（ランナーの世代交代、ブラウザの更新）による揺れの傾向は、まだ評価できない。

## regression-09 自動／手動の分担

**結論**: 77 ケース中 **自動 75 件（97.4%）・手動 2 件（2.6%）**。手動は「実機でしか判定できない」ものだけで、**2 件とも未実施**（実施記録が無い）。

**分担（split）**

| 区分 | ケース数 | 層・内容 |
|---|---|---|
| 自動 | 75 | e2e 38・api 27・unit 10（`cases.csv` の `automation_layer`。主たる層で数えたもの。[03 の 13.1](03-test-spec.md)） |
| 手動 | 2 | TC-071（スクリーンリーダーの読み上げ）・TC-072（iOS Safari の画面キーボードと日本語入力） |

**手動で残す理由（manual_reason）**

- TC-071: VoiceOver・NVDA が何をどの順で読み上げるかは、実機での聞き取りでしか判定できない。axe-core では名前の有無しか検査できず、読み上げの自然さと状態変更の通知は自動化できない。
- TC-072: 実機 iOS Safari のソフトウェアキーボード表示時のレイアウトと、日本語入力の変換確定は、実機の WebKit と IME の組合せでしか再現できない。Playwright の WebKit では再現できない。
- 出典: `docs/data/cases.csv` の `manual_reason`、[03 の 13.2](03-test-spec.md)、`quality/regression-suite.csv` の `manual_reason`。

**探索の役割（exploratory_role）**: 自動化できない種類の確認（読み上げの自然さ、実機の入力方式、見た目の違和感）を人が行う。実施の予定は `docs/evidence/manual-plan.yaml`（担当は QA 担当、予定は 2026-10-31）。**実施記録は現時点で無く、実施表では `not_run`**。未実施を pass にしていない。探索セッション（自由に触って違和感を探す枠）は、v1.0.0 の範囲では**設けていない**。

**自動化の進捗の追い方と見直し**

- 「自動化するはずで未実装のケース」は `quality/known-gaps.yaml` に期限付きで公開する（現在は 0 件）。台帳に無い自動化ケースがテストに対応していなければ CI が失敗する（docs-check の `tc-coverage`: 自動 75 件がすべてテストに対応）。
- 分担の見直しは、四半期ごと・リリース前に、`impact-map`・`journeys` の見直しと同じ場で行う方針（[quality/README.md](../quality/README.md)）。**初回の見直しはまだ行っていない**。見直しの観点: 手動ケースの自動化適性（実機を借りられるか、WebKit で再現できるか）、手動ケースの実施の有無。

## regression-10 保守・陳腐化管理

**結論**: 整理の**仕組み（基準・検出・期限）は揃っている**が、運用が初日のため、**整理した履歴はまだ無い**。スイートの状態は、廃止 0・未実行（90 日以上）0・隔離 2・古い glob の警告 2。

**定期整理（periodic_cleanup）**

| 対象 | 整理の基準・仕組み | 検出 | 頻度・担当 |
|---|---|---|---|
| 変更影響マップ | 新しいファイル・機能を足す PR で同時に更新。廃止した機能のケースは `cases.csv` で扱いを決めてからマップとジャーニーから外す | `impact-check.mjs`（当たらない追跡ファイル・存在しない TC・古い glob） | PR ごと（変更を入れる人）。四半期ごと・リリース前に QA 担当が全体を見直す |
| 回帰ケース | 要求・仕様の改訂に合わせて `cases.csv` の期待結果・`version` を直す | `build-suite.mjs --check`、docs-check の `tc-coverage` | PR ごと |
| 自動化の穴 | `known-gaps.yaml` に期限付きで載せる | docs-check（期限切れで失敗） | QA リード |
| 隔離中のテスト | 期限は since から 30 日以内 | docs-check の台帳検査（期限切れで失敗） | テストの担当 |

**重複（duplicates）**: ケースは観点（VIEW）から 1 対多で作り、同じ検証の別名を作らない設計（[02](02-test-perspectives.md)）。frontend と backend が同じ入力表を流す検証関数のテスト（TC-021〜TC-029）は、層の違う別の検証として**意図して**同じ TC-ID を持つ（[03 の 13.3](03-test-spec.md)）。**手順の重複を機械で検出する仕組み（手順のハッシュなど）は無い**。

**廃止（obsolete）**: スイートの状態は active 73・manual 2・quarantined 2（`regression-suite.csv` の `status`）。obsolete は 0 件（フェーズ1が初版で廃止した機能が無い）。廃止する場合は、`cases.csv` で扱いを決め、journeys・マップから外し、古い glob を `impact-check` の警告で確認する。

**古い期待値**: 未決（UNK）が決まったときにケースを改訂した実績がある（PR #12「ケース改訂と未決の確定を反映」。仕様書 v1.1 の `version: spec-1.1`）。性能のしきい値は TC-073・TC-074 で番兵化した（[ADR-0005](adr/0005-functional-layer-perf-sentinel.md)）。UNK-002（件数の上限）が open のため、TC-073・TC-074 の期待値は暫定のままで、決定後に改訂する（[03 の 13.4](03-test-spec.md) の `@pending`）。

**スイートの健全性指標**（2026-10-11 時点）

| 指標 | 値 | 出典 |
|---|---|---|
| 90 日以上実行されていないケース | 0（77 ケースすべてが 2026-10-11 の全件回帰に入る。手動 2 件は実施記録なし） | `docs/data/executions.csv`、`regression-suite.csv` の `last_run_at` |
| 隔離中のケース | 2 / 77（TC-073・TC-074） | `quality/flaky-ledger.yaml` |
| 古い glob の警告 | 2 | `impact-check.mjs` |
| 自動化の穴 | 0 | `quality/known-gaps.yaml` |

初回の棚卸しは、運用 4 週間後を待たず、**フェーズ2のリリース前、または 2027-01-11（v1.0.0 から 3 か月）のどちらか早い方まで**に行う（予定。承認は本書の PR のマージ＝代行）。実施したら、本章に日付・削除件数・変更件数を追記する。

## regression-11 Flaky・隔離・再試行

**結論**: retry で隠さず、**不安定なテストは台帳に載せ、期限（30 日以内）つきで隔離**している。台帳は 2 件、期限切れは 0。flaky の**週次の自動検出（3 回繰り返し）は、実績がまだ 0 回**である。

**retry で隠さない（no_hidden_retry）**

- Playwright は `retries: 0`、CI でも `--retries=0` を明示（`e2e/playwright.config.js`、`.github/workflows/ci.yml`、`nightly.yml`）。node:test に再試行の機構は無い。
- 再試行で成功した率: v1.0.0 の全件回帰（run 38152472087）で、全層（compose・contract・e2e・unit・api）の `retried_success` が 0（`ci-summary.json`）。0 でなければ設定違反として扱う（[quality/README.md](../quality/README.md)）。
- 緩和ではなく原因を直した例: DEF-015 は、テストの検査を緩めず、**サーバーの挙動を直し**、テストは競合に依存しない形に強化した（PR #21）。しきい値を SLO のままにして retry する案は却下した（[ADR-0005](adr/0005-functional-layer-perf-sentinel.md)）。

**台帳（ledger）と隔離期限（quarantine_expiry）**

| テスト | 失敗率 | 原因（分類） | 担当 | 隔離開始 | 期限 | Issue |
|---|---|---|---|---|---|---|
| TC-073 | 0.1（10 回中 1 回） | 環境差。共有ランナーの負荷で、追加 p95 の絶対しきい値（300ms）を超えた（観測 452ms） | バックエンド担当 | 2026-10-11 | 2026-11-10 | #25（open） |
| TC-074 | 0.1（10 回中 1 回） | 環境差。共有ランナーの負荷と計測の粒度で、追加の反映が 1054ms（しきい値 1000ms）に | フロントエンド担当 | 2026-10-11 | 2026-11-10 | #37（closed） |

- 隔離の規則: 直せないときだけ `flaky-ledger.yaml` に `test_id・rate・cause・owner・since・expires_at` を書く。期限は since から 30 日以内で、**期限が切れると CI（docs-check）が失敗する**。隔離中も日次の全件回帰では実行し続ける（`node scripts/regression/flaky-report.mjs --validate-ledger` は 2026-10-12 に PASS、2 件）。
- 隔離から外す条件: 週次の `--repeat-each=3` で pass と fail の混在が無いことを確認できたら台帳から外し、#25 を閉じる。**週次の実行がまだ無いので、この確認は未実施**。

**原因（cause）の分類と再発防止**

分類は 5 種: タイミング依存／データ共有／外部依存／環境差／本物の不具合（flaky と思ったら不具合だった）。本物の不具合なら `defect` を起票して回帰ケースを足す。実績 3 件:

| Issue | 検出 | 分類 | 再発防止 |
|---|---|---|---|
| #15（DEF-015） | `npm run test -w backend` の繰り返し（main c3a6e84 で 6 回中 2 回失敗） | 本物の不具合（実装のタイミング競合） | サーバー側を修正。315 回の繰り返し（並列度・CPU 負荷を変えて）で失敗 0（PR #21） |
| #25（DEF-025） | PR #8 の CI（run 38123866985） | 環境差（共有ランナー + 絶対時間） | 番兵化（CI はしきい値 3 倍）、本判定は perf 層。台帳で隔離 |
| #37（DEF-037） | main push の CI（run 38140205187） | 環境差（同上） | 同上（PR #38）。#37 は修正済みでクローズ |

**flaky 率の追跡**

- 検出: 同一 SHA・同一テストで pass と fail が混在したものを flaky とする（`scripts/regression/flaky-report.mjs`）。週次の `--repeat-each=3` と、日次・PR の再実行で検出し、台帳に無い flaky は nightly が `flaky` ラベルの Issue を自動起票する（同名の open Issue があれば作らない）。
- 現在の値: 隔離 2 件 / 自動 75 件 = **2.7%**。[ai-context.yaml](ai-context.yaml) に宣言した上限 1% を**超えている**（2 件とも対策済みで、週次の確認待ち）。run 単位では、CI 完了 55 run のうち flaky が原因の赤は 2 run（3.6%）。
- できていないこと: 週次の 3 回繰り返しによる混在検出は 0 回。flaky 率の推移（週・月）は、運用が短くて出せない。

## regression-12 結果・カバレッジ報告

**結論**: v1.0.0 の全件回帰では、**77 ケース中 75 件を実施し全件 pass、2 件（TC-071・TC-072）は未実施**。PR 層では、選択の理由と外したリスクを run ごとに報告している。

**実施したもの（executed）**

- v1.0.0 の全件回帰（Release run 38152472087、commit 5fcf40a…、2026-10-11）: compose 4・contract 8・e2e 43（4 project の実行の合計）・unit 143・api 74、**失敗 0・skipped 0・再試行成功 0**。実施表は 111 行（pass 109・not_run 2）、77 ケースすべてに 1 行以上（`docs/data/executions.csv`）。
- カバレッジ（行）: backend 99.69%・frontend 100%（しきい値 90%）。リスク・要求との対応は [05 の automation-08](05-automation.md)。
- PR 層: run ごとに `regression-selection.json`（選んだ TC・選択理由・外したリスク）を 90 日保持する。

**実施しなかったもの（not_executed）**

- TC-071・TC-072（手動。実機）。
- PR 層で選択から外したケース（例: docs だけの PR では 77 件中 72 件）。main への push の全件回帰で補う。
- 日次・週次の定期実行（まだ起動していない）。週次の 3 回繰り返し。
- 回帰の対象外: 長時間の soak、GitHub-hosted runner での性能 baseline（perf 層の別管理。[01 の plan-03](01-test-plan.md)）。

**実施しなかった理由（not_executed_reason）**

| 未実施 | 理由 | 担当・期限 |
|---|---|---|
| TC-071・TC-072 | 実機でしか判定できず、自動回帰の対象外。実機での実施記録が現時点で無い（`manual-plan.yaml`） | QA 担当、2026-10-31（暫定。リリース判定の日程が決まったら更新） |
| PR 層の選択外のケース | 変更影響の範囲外で、変更のないものを毎回回す費用に見合わない。main への push で全件を回す | 方針（regression-04） |
| 日次・週次 | 定期実行の初回がまだ来ていない（最初の起動は 2026-10-11 18:00 UTC） | 運用（regression-06・13） |

**変更のリスク（change_risk）**

- 変更の種類ごとのリスクは、`impact-map.yaml` の `excluded_risk` に書いてある（regression-02 の表）。PR の run ごとに、選んだケース・外したリスク（RISK ごとの除外 n/m）を出す（regression-04）。
- **突合**: 1 つの run について、`regression-selection.json`（選んだ TC）と `ci-summary.json`（TC ごとの pass/fail）を突き合わせる。全件で落ちたのに選択から外れていたケースを `selection-audit.json` に残す機構が `verify-selection.mjs`（regression-13）。
- v1.0.0 全体のリスク: 未実施 2 件による RISK-007（モバイル・アクセシビリティ）・RISK-014（ブラウザ差）の実機側の穴が残る。**受容**は、期限（2026-10-31）つきで本書のマージ（プロダクトオーナーの承認）による。残存リスクの全体の扱いは [01 の plan-12](01-test-plan.md)。

## regression-13 フル回帰の定期確認

**結論**: 全件回帰の周期は **1 日**（`nightly.yml` の日次）と定めた。全件を回した実績は 2026-10-11 の 1 日にあるが、**定期実行（schedule）としての実績は、数えた 16:12 UTC の時点で 0 回、その後に日次・週次が各 1 回**で、**選択ロジックの漏れを定期検証した記録（`selection-audit.json` の履歴）は、まだ積み上がっていない**。

**周期と実績**

| 項目 | 内容 |
|---|---|
| 周期 | 1 日（[ai-context.yaml](ai-context.yaml) の `full_regression_cadence_days: 1`）。日次は毎日 UTC 18:00、週次は日曜 UTC 20:00 |
| 全件を回した実績 | main push 13 回（直近 run 38153550607、2026-10-11 15:59 UTC、success）、リリース 1 回（run 38152472087、2026-10-11 15:43 UTC、success）、nightly.yml の PR 検証 1 回（run 38130390783、2026-10-11 10:00 UTC、全件 75 ケース success） |
| 定期実行（schedule）の実績 | 数えた時点（16:12 UTC）で 0 回。その後、**日次 1 回（run 38176336541、21:25 UTC）・週次 1 回（run 38183878218、23:20 UTC）がともに成功**（どちらも定義の時刻より 3 時間以上遅れて起動）。日次の run のレポート（`nightly-report-daily`）は、観察したテスト 258・flaky 0・隔離台帳の問題 0、`selection-audit.json` は `no_leak_detected`（ただし直近の変更が全件実行にフォールバックする内容だったため、選択ロジックの検証の対象外と注記されている） |
| 周期超過の検知 | `health-trend.json` の `last_success_at` で確認できるが、**周期を超えたら自動で失敗にする仕組みは無い**（できていないこと） |

**選択ロジックの検証（verify-selection）**

- 仕組み: nightly の report ジョブが、直近 10 コミットの変更から `select.mjs` が選ぶケースと、全件で実際に落ちたケースを突き合わせ、`selection-audit.json` に `no_leak_detected` / `leak_detected` を残す。
- 実行の記録: 1 回（run 38130390783）で `no_leak_detected`（選択 75 / 全件 75 / 全件で失敗 0）。**ただし、このときの選択は全件モード**（CI の定義ファイルを触る PR だったため）で、選択から外れたケースが無い。したがって**選択ロジックの検証としては成立していない**。
- 選択ロジックの漏れが見つかった実績: 0 件（検証していないので、漏れが無いという意味ではない）。

最初の定期実行が済んだら、本章の「実績 0 回」を run ID と結果に更新する。更新の担当は QA 担当。

## regression-14 データ・スキーマの後方互換

**結論**: **v1.0.0 では、スキーマ変更の移行・切り戻しを実際に流して確かめたことは無い**。スキーマが 1 版（v1）しか無く、移行が 1 度も起きていないためである。確かめたのは**移行の仕組み（機構）の単体テスト**と、**イメージの切り戻し訓練**（データを動かさない）までで、データ込みの互換・切り戻しの検証は**フェーズ2で初めて実際に流す**。その方針と計画を以下に書く。

**現状（実際にやったこと）**

| 確かめたこと | 内容 | 出典 | 限界 |
|---|---|---|---|
| 移行機構の単体テスト | 空の DB への v1 適用・`schema_migrations` への記録、冪等（2 回目は何も書かない）、前進のみ（後から足した v2 だけが適用され、既存データは保たれる）、途中で失敗した migration の巻き戻り（バージョンも記録されない）、`schema_migrations` が無い既存の tasks への v1 記録 | `backend/test/api/migrations.test.js`（5 件、補助テスト） | v2 は**テスト内で作った仮の `ALTER TABLE ... ADD COLUMN`**。実際のフェーズ2のスキーマではない |
| 壊れたデータの上に書かない | 破損 DB・不正行を開いても、自動で上書きせず、SHA-256 が前後で変わらない | TC-052〜TC-055（RISK-004） | 移行の途中で壊れた場合の検証ではない |
| イメージの切り戻し訓練 | 悪い版の検知から前のイメージへの rollback まで（いずれも検知から 16 秒）。2 回実施 | `monitoring/drills/20261011T0725Z-rollback/`、`monitoring/drills/20261011T1220Z-rollback-after-16fix/` | **データのスキーマは両方とも v1**。前のイメージはローカルでタグ固定したもので、GHCR の digest 解決は未検証 |

**方針**（`backend/src/store/migrations.js`、[RB-002](../monitoring/runbooks/RB-002-backend-health.md)）

1. **前進のみ**: 既存の版の定義は書き換えず、新しい版を足す。逆方向のマイグレーションは持たない。
2. **冪等**: 適用済みなら DB を書かない（読み取り専用の DB でも起動できる）。
3. **トランザクション**: 1 つの版を `BEGIN IMMEDIATE` の中で適用し、失敗したら巻き戻す。複数プロセスが同時に起動しても二重に適用しない。
4. **列は消さず追加のみ**に寄せる（フェーズ2の `dueDate` は任意・初期値 null の追加）。API は `/api/v1` の後方互換で、フィールド追加は非破壊（`backend/openapi.yaml`、oasdiff が検出）。
5. **旧データの読み取り**: 新しい版は、旧版が作ったデータ（`dueDate` が無い行）を、期限未設定（null）として読む。読み込みだけで書き換えない。
6. **切り戻し**: 前のリリースのイメージ（digest 固定）へ戻す。**スキーマが前進済みなら、切り戻しの前に取った DB バックアップ（ボリューム `todo-data` の tar）を使って復元する**。

**フェーズ2での検証計画**（ここから先は計画で、まだ実施していない）

用語: **前方互換**＝旧データ（v1）を新しい版が読める。**後方互換**＝新しい版が書いたデータを旧い版が読める。

| 項目（キー） | 検証の内容 | 合格基準 | 担当 | 時期 |
|---|---|---|---|---|
| 移行手順の検証（data_migration_verified） | v1.0.0 のイメージで作った DB（標準 3 件・同時刻 3 件・1,000 件）を、v2 の backend で起動する。起動を 2 回行う | 全行の id・title・completed・created_at と並び順が不変（行数 100% 一致）、`dueDate` は全行 null、`schema_migrations` は version 1・2 が 1 回ずつ、2 回目の起動で DB ファイルの SHA-256 が変わらない | バックエンド担当 | マイグレーション v2 を含む**最初の PR のマージ前**（CI の api 層に固定フィクスチャとして常設） |
| 前方互換の確認（forward_compatible） | 上記の旧データを新版の画面と API で読む（AC-15） | 件数・既存値・順序が保たれ、全件が「期限：未設定」と表示される。読み込みだけで保存データが書き換わらない | バックエンド担当・フロントエンド担当 | 同上 |
| 後方互換の確認（backward_compatible） | v2 が書いたデータ（`dueDate` あり）を、**v1.0.0 のイメージ（旧版）**の backend と、キャッシュされた旧い画面から読む | 旧版が起動し、一覧・追加・完了切替・削除が成功し、`dueDate` の値が変わらない。旧い画面が `dueDate` を含む応答を表示できる | バックエンド担当 | v2 のリリース判定の前 |
| 切り戻しの確認（rollback） | RB-002 の手順を、**v2 のデータで**通す。(a) バックアップから復元して v1.0.0 を起動、(b) 復元せずに v1.0.0 を v2 のデータで起動、の 2 経路 | (a) 復元後の全行がバックアップ時点と一致（行ハッシュで 100%）。(b) 旧版がデータを壊さない（SHA-256 の差分が復元対象外の列に無い）。どちらも外形監視の全 MON が成功し、所要時間を記録する | 運用（SRE）担当 | v2 のリリース判定の前（リリース前層の必須項目にする） |

- 合格しないときの扱い: 「前進のみ・列追加のみ」の方針を見直す（逆マイグレーションを持つか、リリースを止める）。検証を通らない版はリリースしない。
- **現行の runbook との差**: [RB-002](../monitoring/runbooks/RB-002-backend-health.md) の注意書きは、戻した版が起動に失敗するときに**「バックアップから復元せず、メンテナに連絡する」**とあり、**復元の手順を持っていない**。上の方針 6（復元して戻す）に合わせて、フェーズ2の着手前に RB-002 へ復元の手順と判断基準を足す（運用（SRE）担当。`monitoring/` の変更なので別 PR）。
- 検証の出し方: v1.0.0 で作った DB のスナップショットを固定のフィクスチャとして残し、v2 以降のすべての版で同じ検証を回す（regression-10 の棚卸しで、フィクスチャが古くなっていないかを見る）。
- 関連: RISK-012（将来のスキーマ移行失敗。low）と観点 VIEW-042 は、v1.0.0 では非適用（移行元が無い）で、フェーズ2の設計時にケースを設計する（[02](02-test-perspectives.md)）。フェーズ2は対象外（見直し日 2026-12-12。[ai-context.yaml](ai-context.yaml) の `scope.excluded`）。

## regression-15 版の組み合わせ互換

**対象外（N/A）**。この観点は、次の理由で**承認済みの対象外**として扱う（承認は PR のマージ＝代行で、オーナーの確認は未実施。下記）。

**対象外・理由・承認・見直し日**

| 項目 | 内容 |
|---|---|
| 対象外にするもの | 版の組み合わせ互換（frontend と backend の版違い、旧版クライアントとの組み合わせ） |
| 理由 | 外部連携が無く、frontend と backend は**同一リリース単位**である（同じタグ・同じ commit から両イメージを作る。`release.yml`）。版違いの組み合わせは運用しない。互換の方針は **API の `/api/v1` の版**で扱い、`/api/v1` は後方互換（フィールド追加は非破壊、削除・型変更・必須化は `/api/v2`）を保つ。破壊的変更は oasdiff が CI で検出する（`backend/openapi.yaml`、`scripts/ci/oasdiff-breaking.sh`） |
| 承認 | プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ）。**承認日は本書を含む PR #53 のマージ日（2026-10-12）。AI の代行マージで、オーナーの確認は未実施**。計画上の根拠は [01 の plan-03](01-test-plan.md)、機械可読な記録は [ai-context.yaml](ai-context.yaml) の `exceptions`（EXC-005） |
| 見直し日 | 2026-12-31、または `/api/v2` を出す判断のときの、どちらか早い方（[01 の plan-03](01-test-plan.md) と同じ） |
| 前提が崩れたときの扱い | frontend と backend を別々にリリースする、または外部連携を足すなら、組み合わせ表（N と N-1）と互換ケースを追加し、回帰スイートに載せる |

**書く項目の扱い**（対象外のため、項目ごとに事実だけを書く）

- 対応する版の範囲（supported_versions）: 同一リリース単位の 1 版のみ（v1.0.0 の frontend × backend）。API は `/api/v1`。
- 組み合わせの検証表（combination_matrix）: 無い（組み合わせを運用しないため）。
- 最も古い対応版（oldest_supported）: 最新の 1 版。ただし切り戻しでは 1 つ前のリリースのイメージ（digest 固定）へ戻す（[RB-002](../monitoring/runbooks/RB-002-backend-health.md)。データの互換は regression-14）。
- 打ち切り方針（sunset_policy）: 定めていない（単一版の運用で、旧版との共存が無い）。`/api/v2` を出すときに、`/api/v1` の廃止の予告期間と告知を決める。

**補足**: 旧版クライアント（キャッシュされた旧い画面）が新しい backend の応答を読めることは、組み合わせ互換ではなく**データ互換の一部**として regression-14 の「後方互換の確認」で扱う。

## 変更履歴

| 版 | 日付 | 内容 | 作成 | レビュー | 承認 |
|---|---|---|---|---|---|
| 1.0 | 2026-10-12 | 初版（v1.0.0 の回帰運用の方針・実績・できていないこと） | QA 担当（AI エージェントが作成） | QA リード（未実施） | プロダクトオーナー（PR #53 のマージ＝承認の代行。オーナーの確認は未実施） |
| 1.1 | 2026-10-12 | 横断整合（時点依存の記述を現状へ）: 実施表・不具合表が main に取り込み済み（PR #42）、台帳の列（`last_run_at` ほか）・`change_kind`・DEF-036/037 の反映（PR #57）、health-trend の p95 は 600 秒（nightly だけ 1800 秒）、数字を main の CSV から数え直し | QA 担当（AI エージェントが作成） | QA リード（未実施） | プロダクトオーナー（PR のマージ＝承認の代行。オーナーの確認は未実施） |
