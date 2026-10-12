# 09 テスト実施・結果記載

| 項目 | 内容 |
|---|---|
| 文書ID | DOC-09 |
| 版 | 1.1 |
| 更新日 | 2026-10-12 |
| 状態 | draft（オーナーの確認待ち。PR マージ＝承認の代行） |
| 対象 | todo-app 仕様書 v1.1（spec/todo-phase1-spec.html）、リリース v1.0.0（commit 5fcf40a7e58dc253e53ff56860d0669a69abda26） |
| 作成 | QA 担当（ロール。実作業は AI エージェント） |
| レビュー | QA リード（未実施。作成者と同じ主体の兼務で、第二の目は無い） |
| 承認 | プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ。オーナーの確認が済むまで draft のまま） |
| 正本 | この md と、[docs/data/executions.csv](data/executions.csv)（実施表）・[docs/data/defects.csv](data/defects.csv)（不具合表）・[docs/data/evidence-index.csv](data/evidence-index.csv)（証拠索引）・[docs/evidence/](evidence/README.md)（Git が版管理） |

この文書は、v1.0.0 のテストを**どの版に・どの環境で・どう実施し、何が起き、何を実施できず、その結果を第三者がどう確かめられるか**を記録する。
**行そのもの（1 行 = 1 ケース × 1 実行環境 × 1 run）は実施表 CSV が正本**で、本書は集計・読み方・判断を書く。数字は CSV から数え直したもので、出典を添える。

## この文書の結論

- **対象版は 1 つだけ**: 実施表 111 行はすべて commit `5fcf40a7e58dc253e53ff56860d0669a69abda26`（タグ v1.0.0）、run 38152472087（Release ワークフロー）。版の混在は 0（execution-01）。
- **結果**: 77 ケース中 75 ケースが pass（109 行）、2 ケース（TC-071・TC-072。実機の手動ケース）は **not_run**（2 行）。fail・blocked・skipped は 0。必須 66 ケースは 66 が pass、任意 9 も 9 が pass（execution-04）。
- **証拠**: pass 109 行のすべてに、JUnit と観察値の 2 件（計 218 件）が付き、証拠索引に解決し、sha256 が一致する。ただし**画面キャプチャは無い**（execution-06）。
- **不具合**: 起票 10 件（修正済み 7・未修正 3。critical 0・major 2〔修正済み〕・minor 8）。未修正 3 件はすべて minor で Issue と期限・追跡先がある（#31 は 2026-10-12 の Issue コメントで担当・期限 2026-12-31・回避策が追記済みで、ACT-006 の期限も 2026-12-31 に一本化した。execution-07）。
- **できていないこと**: ①手動 2 ケース未実施（実施予定 2026-10-31 は暫定）。②人による第三者の追認は未実施（機械による再計算のみ）。③性能（perf.yml）の v1.0.0 の結果（run 38152548008）は PR #61 で `docs/evidence/perf/` に取り込み済みで、成果物 [07](07-performance.md) にまとめた（想定負荷で SLO 全達成。実施表の対象外）。④v1.0.0 のイメージ（digest 固定）に対する外形監視の結果は Actions 上にある（2026-10-12 17:00 JST 時点で schedule の通常実行 4 回、すべて 11/11 成功。通知試験 2 回は通知経路の試験で成功率の根拠でない）が、**実施表・`docs/evidence/monitoring/` には取り込んでいない**。schedule の間隔は 3〜7 時間で、稼働率の評価には足りない（[11](11-monitoring.md)）。⑤開始条件の確認は、実施前に人が署名した記録ではなく、機械の確認と事後の再構成（execution-02）。⑥実施表は最終 run のみで、過去の失敗の履歴は Issue にあり表には無い。
- **数字の出典と時点**: 本書の数字は、main の `docs/data/*.csv` と `docs/evidence/runs/38152472087/` から数え直した（2026-10-12、main c14d39a）。PR #42（v1.0.0 の証跡の取り込み）は **2026-10-11T16:30:20Z にマージ済み**で、main の実施表・不具合表・検出表は v1.0.0 の run（38152472087、対象 5fcf40a）になっている。旧 run（38128562945、対象 52da4aa）の行は実施表に残らない。食い違えば CSV が正。

### 実施表の集計（`docs/data/executions.csv`、run 38152472087 の 111 行）

| 切り口 | 内訳 |
|---|---|
| 行数・ケース数 | 111 行、77 ケース（ケースごとの行数: 1 行 47・2 行 27・3 行 2・4 行 1） |
| kind | regression 109（push・タグの全件回帰）、manual 2 |
| status | pass 109、not_run 2、fail 0、blocked 0、skipped 0 |
| 実行環境（`environment` の先頭） | e2e/chromium 33（うち 3 行はビューポート 360x640）・e2e/firefox 3・e2e/webkit 3・e2e/chromium-mobile-360 1・unit(frontend) 27・unit(backend) 9・api 27・contract 2・compose 4・実機（スクリーンリーダー）1・実機（iOS Safari）1 |
| 必須区分（`cases.csv`） | 必須 66 → pass 66。任意 9 → pass 9。探索 2 → not_run 2 |
| 不具合に関連付いた行（`defect_ids`） | 11 行（DEF-005 が 1、DEF-006 が 5、DEF-011 が 4、DEF-015 が 1。いずれも修正確認の pass 行） |
| 実施日時（`executed_at`） | 2026-10-11T15:43:47Z〜15:45:21Z（UTC。JST では 2026-10-12 00:43〜00:45）の 109 行。manual 2 行は空 |

## execution-01 対象Build・Commit

**結論**: 111 行すべてに commit_sha と実行環境があり、commit は 1 種類（5fcf40a…）、対象版と一致、不一致 0。混在を防ぐ仕組みを 4 つ持つ。

| 固定する対象 | 値 | 出典 |
|---|---|---|
| 版・タグ | v1.0.0 | `docs/evidence/release.json`（PR #42 で main に取り込み済み）、[Release v1.0.0](https://github.com/bsj-fujimoto/todo-app/releases/tag/v1.0.0) |
| 製品 commit | `5fcf40a7e58dc253e53ff56860d0669a69abda26`（111 行中 111 行） | `executions.csv` の `commit_sha` |
| ビルドした run | 38152472087（Release ワークフロー、event=push、ref=v1.0.0、attempt 1。2026-10-11T15:43:26Z 作成、成功） | `docs/evidence/runs/38152472087/SOURCE.json` |
| artifact（イメージ） | backend `sha256:87addb2e…a213`、frontend `sha256:c82e88ba…ee9a`（全桁は `release.json`。Release 本文の digest と一致を確認した） | `release.json`、Release 本文 |
| 実行環境の設定 | runner `ubuntu-24.04`（image 20261004.327.1、runner 2.337.0）、Linux 6.17.0-1022-azure x64、Node v24.21.0、chromium 156.0.8078.4・firefox 157.0・webkit 27.2、ロケール ja-JP、ビューポート 1280x800 と 360x640、再試行 0（`retries: 0`） | 各行の `environment`、観察値の `environment`、ジョブのログ |

- 実行環境の組は 12 種類（上の集計表）。各行の `environment` は空でない（111 / 111）。
- **混在防止の仕組み**（いずれも `scripts/evidence/`）:
  1. `build-executions.mjs --prune-other-versions --release <SHA>` が、別の版の行を実施表に残さない。
  2. `check-evidence.mjs` が実施表の `commit_sha` の種類数を数え、2 種類以上なら失敗にする。`release.json` があれば、その `commit_sha` 以外の行も失敗にする（`--strict`。PR #42 の CI `docs-check` で通過を確認した。以降の main の CI でも毎回動く）。
  3. 観察値・`ci-summary.json`・`SOURCE.json` の SHA と run id を、取り込んだ run と突き合わせる（109 件の観察値すべてが 5fcf40a と一致）。
  4. JUnit の層別の件数を `ci-summary.json` と突き合わせる（取り込み漏れ・別 run の混入の検知）。
- **限界**: タグ v1.0.0 を別の commit へ付け替えることは、リポジトリ設定上は止まっていない（リリースタグの Ruleset が**未適用**。ACT-008、期限 2026-10-16）。付け替えが起きても、実施表の SHA・イメージ digest との不一致で**検知**はできるが、**防止**はできていない。
- 実施表は PR #42 のマージで、旧 run（commit 52da4aa）から v1.0.0 の run に取り替わった。**旧 run の行と v1.0.0 の行は同じ表に同居させない**（実施表を v1.0.0 の run から作り直す。execution-03 の DEV-006）。旧 run の証跡ファイル（`docs/evidence/runs/38128562945/`）は履歴として残し、`SOURCE.json` の `superseded_by` で置き換え済みの印を付けた（実施表・証拠索引の根拠ではない）。

## execution-02 開始条件確認

**結論**: v1.0.0 の run では、環境・データ・依存サービスの確認は**機械が実施前に行い**（ジョブの成功・healthcheck・台帳検査）、既知障害の確認は**事後に QA 担当が Issue の履歴から再構成した**。実施前に人が署名した開始条件のチェックリストは**無い**（できていないこと）。時刻はすべて UTC。

**確認した日時（checked_at）**: run 作成 2026-10-11T15:43:26Z。各ジョブの開始は下表（GitHub Actions のジョブ記録）。

**環境の確認（environment）**

| 実施環境（実施表の `environment`） | 確認した事実 | 確認した仕組み | checked_at（ジョブの開始〜終了） |
|---|---|---|---|
| unit(frontend)・unit(backend)・api | runner ubuntu-24.04（image 20261004.327.1）、Node 24 を入れ（`mise.toml` と同じ版。観測値 v24.21.0）、`npm ci` が成功 | `.github/actions/setup-node-npm`、ジョブ `unit-api` の成功 | 15:43:37Z〜15:44:00Z |
| contract | 同上。redocly lint・oasdiff・契約適合が成功 | ジョブ `contract` の成功 | 15:43:29Z〜15:43:50Z |
| e2e/chromium・e2e/chromium-mobile-360 | Playwright のブラウザを入れ（chromium 156.0.8078.4）、各テストが専用の backend・frontend・一時 DB を起動 | ジョブ `e2e (chromium)`・`e2e (chromium-mobile-360)` の成功。起動時にバックエンドの health が応答するまで待つ（`e2e/fixtures/backend-process.js`） | 15:43:37Z〜15:44:30Z、15:43:37Z〜15:44:10Z |
| e2e/firefox・e2e/webkit | firefox 157.0・webkit 27.2（Linux）。**開発機（macOS）の Firefox は動かないため CI で実行**（DEV-003） | ジョブ `e2e (firefox)`・`e2e (webkit)` の成功 | 15:43:38Z〜15:44:16Z、15:43:37Z〜15:44:27Z |
| compose | Docker（runner のネイティブ）で `docker compose up -d --build --wait --wait-timeout 180`。backend の healthcheck（間隔 5 秒・タイムアウト 3 秒・start_period 10 秒・再試行 10）が通るまで待ち、frontend は backend が healthy になってから起動する。TC-076 が health 200・`status: ok`・`db: ok` を検査する | `docker-compose.yml`、ジョブ `compose` の成功 | 15:43:29Z〜15:45:45Z |
| 実機（スクリーンリーダー・iOS Safari） | **確認できていない**。実機・実施者が手配されていない | execution-08 | — |

**テストデータの確認（data）**

- データは固定ファイルを持たず、**テストごとに専用の DB・ブラウザコンテキストを新しく作る**（DS-001〜DS-012。正本は [datasets.csv](data/datasets.csv)）。空 DB（DS-001）、標準 3 件（DS-002）などはテストコードが投入し、投入後の状態は観察値に残る（例: TC-008 の観察値は一覧 3 行）。
- 全ケース 77 件の前提条件（`precondition`）と後始末（`cleanup`）は `cases.csv` に書かれている（`cleanup` は 77 / 77 が記入）。
- 確認の日時は、各行の `executed_at`（観察値の `started_at`）。2026-10-11T15:43:47Z〜15:45:21Z。

**依存サービスの確認（dependencies）**

- 外部サービス連携は無い（観点 VIEW-060。[01 テスト計画書](01-test-plan.md) の plan-07）。実際に使う周辺は GitHub Actions・npm レジストリ・Playwright ブラウザの取得・コンテナのベースイメージで、**モックにせず本物に接続**する。run 38152472087 では `npm ci`・ブラウザの導入・イメージのビルドがすべて成功し、ジョブが開始できた（15:43:29Z〜）。
- GHCR は、テスト後の `publish` ジョブ（15:45:56Z〜15:47:00Z）で使う。テストの前提ではない。
- 障害の注入（503・応答の保留・接続中断）は Playwright の `page.route` で行い、backend 側は変更しない（DS-012）。

**既知障害の確認（known_issues）**（2026-10-11T15:43:26Z 時点の Issue の状態。事後の再構成）

| 状態 | Issue | 実施結果への影響の判断 |
|---|---|---|
| open | #25（TC-073 の flaky）、#31（性能: CPU 飽和）、#33（CodeQL の受容追跡）、#22（zlib の受容） | TC-073・TC-074 は任意・番兵（[ADR-0005](adr/0005-functional-layer-perf-sentinel.md)）。CI のしきい値は 3 倍で、隔離は期限つき（`quality/flaky-ledger.yaml` の 2 件、期限 2026-11-10）。#31・#22・#33 は、ケースの合否を左右しない（#33 はケースが無い）。**判定には含めない**が、リリース判断の残存リスクには載せている |
| closed | #5・#6・#11・#15・#16・#36・#37（すべて 2026-10-11T12:59Z までに修正してクローズ） | 修正済みの状態で実施した（execution-11） |
| 台帳 | `quality/known-gaps.yaml` は gaps が空（自動化予定でテストが無いケースは 0） | 台帳の形式・期限は CI の `docs-check` が毎回検査（同 run の `docs-check` は成功） |

- **チェックリスト化**: 上の表が実施環境ごとの確認の記録の形である。ただし、**実施前に人が確認・署名した記録ではない**。人の確認は、PR のマージ（プロダクトオーナー）に集約されている。
- 次回の改善: リリースタグの run の前に、開始条件（plan-11 の開始条件 5 つ）を満たしたことを Issue に 1 行で残す。

## execution-03 手順遵守・逸脱記録

**結論**: 手順どおりに実施できなかった事項を **7 件**記録した（DEV-001〜DEV-007）。7 件すべてに承認の根拠（PR のマージ）がある。DEV-006 の根拠である PR #42 は 2026-10-11T16:30:20Z にマージされ、承認の根拠が成立した（以前の版は「未マージで未承認」と書いていた）。ただし承認はすべてプロダクトオーナーの PR のマージ（フェーズ1は AI が代行）で、独立した第二の承認者はいない。

| ID | 対象（実施 ID・ケース） | 代替手順（steps） | 差分 | 理由（reason） | 承認（approved_by。ロールと根拠） | 仕様書・計画への還流 |
|---|---|---|---|---|---|---|
| DEV-001 | EXEC-0104 TC-071（スクリーンリーダー実機） | 実施せず not_run とした。代替の自動検査（axe-core 等）は名前の有無しか見られず、読み上げの検証には**代えない** | 読み上げの内容・順序・状態変更の通知が**未確認** | 実機（macOS の VoiceOver・Windows の NVDA）と実施者が手配されていない | プロダクトオーナー（探索 2 件以内の未実施を許容する plan-12 を含む PR #41 のマージをもって承認。2026-10-11T16:01Z、AI が代行マージ） | `manual-plan.yaml`、plan-12、ACT-004 |
| DEV-002 | EXEC-0105 TC-072（iOS Safari 実機） | 実施せず not_run。Playwright の WebKit（DEV-007）は代わりにならない（ソフトウェアキーボード・日本語 IME は再現できない） | ソフトウェアキーボード表示時のレイアウトと変換確定の挙動が**未確認** | 実機の iPhone と実施者が手配されていない | 同上 | 同上 |
| DEV-003 | EXEC-0002 TC-001・EXEC-0079 TC-056・EXEC-0102 TC-070（firefox の 3 行） | 開発機（macOS）でなく、CI の Linux（ubuntu-24.04）で Firefox を実行 | 実施環境が開発機と CI で異なる（Firefox は CI のみ） | Firefox が macOS の開発機で動かない。**原因の切り分けは未実施** | プロダクトオーナー（plan-07 の差異 4 を含む PR #41 のマージをもって承認） | plan-07 の差異 4 |
| DEV-004 | EXEC-0011 TC-008・EXEC-0065 TC-046・EXEC-0082 TC-057・EXEC-0091 TC-063（e2e/chromium） | 通信の遅延は「固定時間の遅延」でなく「応答を**保留して解放する**」方式で再現（`e2e/fixtures/gate.js`） | DS-012 に書かれた「指定ミリ秒の遅延」と方式が違う | 固定時間の遅延は共有ランナーで不安定になり、通信中の状態を決定的に観察できないため | 開発リード（UNK-005 の決定、2026-10-11。反映は PR #12 のマージ）。承認はプロダクトオーナーの PR マージ | [03 テスト仕様書](03-test-spec.md) の 9 章、`cases.csv` の TC-057・TC-063（還流済み）。**DS-012 の記述に「指定ミリ秒の遅延」が残っている**（依頼として報告） |
| DEV-005 | EXEC-0106 TC-073・EXEC-0107 TC-074 | CI（環境変数 `CI` あり）では性能のしきい値を **3 倍**にして判定（TC-073: 一覧 1500ms・追加 900ms、TC-074: 表示完了 6000ms・各操作 3000ms）。ローカルは従来値（500・300・2000・1000ms） | 合否のしきい値が CI で緩い。2〜3 倍の劣化は機能層で見逃す | 共有ランナーの負荷で同じコードが pass と fail を繰り返した（#25・#37） | QA リード・バックエンド担当・フロントエンド担当の決定、プロダクトオーナー（PR #38 のマージをもって承認。2026-10-11T12:59Z） | [ADR-0005](adr/0005-functional-layer-perf-sentinel.md)、`cases.csv` の TC-073・TC-074（還流済み）。本判定は perf 層 |
| DEV-006 | 実施表の全 111 行 | 実施表の基準を、main への push の run 38128562945（対象 52da4aa）から、**v1.0.0 の Release run 38152472087（対象 5fcf40a）**へ取り替えて作り直した | 実施表の対象 commit が 52da4aa から 5fcf40a に変わった。旧 run の行は残さない | タグ（5fcf40a）の版に結果を固定するため。タグは「テストした製品 commit」に打ち、証跡は後から取り込む運用（`scripts/evidence/README.md`） | プロダクトオーナー（PR #42 のマージをもって承認。2026-10-11T16:30:20Z、AI が代行マージ。**承認の根拠は成立した**） | `docs/evidence/README.md`・`scripts/evidence/README.md`（リリースの証跡の運用）。取り込み後に main の CSV で本書の数字を再確認した（2026-10-12。一致） |
| DEV-007 | EXEC-0003 TC-001・EXEC-0080 TC-056・EXEC-0103 TC-070（webkit の 3 行） | 実機の Safari でなく、Linux 上の Playwright の WebKit 27.2 で実施 | 実機 Safari と同一ではない（IME・キーボード・描画の差が残る） | 実機が無い（DEV-002 と同じ） | プロダクトオーナー（plan-07 のブラウザの記載を含む PR #41 のマージをもって承認） | plan-07（端末・ブラウザ） |

- **還流**: DEV-004・DEV-005 は仕様書（03）・ケース・ADR に反映済み。DEV-001〜003・007 は計画書（01）に残存リスクとして反映済み。DEV-004 は DS-012 の文言のみ未反映。
- **承認の実効性**: プロダクトオーナーとして承認するのはリポジトリオーナー 1 名で、逸脱の作成者・実施者と同じ主体の兼務。承認が妥当かの独立した確認は無い（人の確認が要る）。

## execution-04 結果Status定義

**結論**: status は **pass / fail / blocked / not_run / skipped** の 5 語（小文字・スネークケース）に統一し、111 行すべてがこの語彙内（表記揺れ 0・語彙外 0・空欄 0）。定義と集計は下表で、集計は CSV の行数と一致する。

| status | 意味 | 使う条件 | 必須の付随情報 | v1.0.0 の件数 |
|---|---|---|---|---|
| pass | 期待結果のすべてを観察して合致した | JUnit の該当テストがすべて成功し、観察値が期待どおり。**再試行（retry）で通したものは pass にしない**（`retries: 0`、`retried_success` は常に 0） | 観察値（`actual_result`）、証拠 ID、ISO 8601 の `executed_at` | 109 |
| fail | 期待結果と 1 つでも食い違った、またはテストが異常終了した | 不具合を起票し、`defect_ids` を付ける | 同上 ＋ `defect_ids` | 0 |
| blocked | **実施しようとしたが、環境・依存サービス・前提条件の障害で実施できなかった**（原因が外にある） | 環境が復旧したら再実施する | `reason`・`owner`・`retest_due` | 0 |
| not_run | **実施していない**（着手・手配がされていない、仕様不明で止めた、計画上まだ実施しない） | 手配が始まって環境が確保できなければ blocked に変える | `reason`・`owner`・`retest_due` | 2（TC-071・TC-072） |
| skipped | 意図して除外した（テストコード上の skip、対象外の判断） | 対象外の承認がある場合のみ | 理由と承認 | 0 |

- **TC-071・TC-072 を blocked でなく not_run とした判断**: 実機と実施者の手配がまだ始まっていない（環境の障害ではない）ため。手配したが実機を確保できない場合は blocked に変える。
- **集計の規則**: 合格率 = pass ÷（pass + fail）、消化率 =（pass + fail）÷ 全行。ケース単位では、ケースの全行が pass なら合格、1 行でも fail なら不合格、pass 行が無ければ未実施。**消化しただけでは判定しない**（[01 テスト計画書](01-test-plan.md) の plan-12）。
- **集計値（v1.0.0）**: ケース 77 のうち pass 75（97.4%）、not_run 2。必須 66 は pass 66（100%）。行では pass 109 ÷ 111 = 98.2%（not_run を除く 109 行では 100%）。
- **語彙の検査**: `scripts/evidence/lib/execution-checks.mjs` の `STATUSES` が語彙外を失敗にする。`kind` の語彙は `automated`（pull_request の run）・`regression`（push・タグ・定期の全件回帰）・`manual`（今回は regression と manual のみ）。
- JUnit の層別の件数（compose 4・contract 8・e2e 43・unit 143・api 74 = 272 テスト、失敗 0・skipped 0）は、実施表の行（1 ケース × 1 環境で 1 行）と数え方が違う。e2e の 43 テストと実施表の e2e の 40 行の差 3 は、chromium で TC-008・TC-058・TC-069 が 2 テストずつあるため（JUnit を数えて確認）。

## execution-05 実測値・観察結果

**結論**: pass 109 行すべての `actual_result`（観察値）が、期待結果の転記でなく、**テストが実際に観察した値**から機械的に組まれている（期待結果と同一 0 件、期待結果の全文を含むもの 0 件、8 文字未満 0 件、空 0 件。中央値 123 文字、29〜700 文字）。73 行が通信の「method path → status」を、5 行が計測値（ms）を含む。

**観察の採り方**: 各テストが終了時に、画面の行（表示テキスト・チェック状態・通信中）、入力欄の値、表示中のエラー文言、フォーカス、観測した API 呼び出し（method path → status と要求・応答の要約）、ブラウザ名と版・ビューポート・OS・Node 版を JSON に書き出す（`e2e/fixtures/observe.js`、`backend/test-support/observe.js`）。`build-executions.mjs` が**観察値だけから** `actual_result` を組み、期待結果は読まない。期待結果と同一なら生成が失敗する。UUID は `{uuid}` に伏せる。

**観察値の例**（実施表の行。期待結果は `cases.csv`）

| 実施 ID | ケース・環境 | 観察した値（`actual_result` の要点） | 期待結果との関係 |
|---|---|---|---|
| EXEC-0022 | TC-016 空白のみの追加・e2e/chromium | 一覧 0 行。入力欄「   」。入力エラー「タスク名を入力してください」。一覧メッセージ「タスクはありません」。フォーカス「title-input」。API は GET /api/v1/tasks→200 のみ | 期待は「入力欄の直下にエラー、保存エラー領域は空、POST は送られない」。観察値は文言とフォーカスまで実測で、POST が出ていないことも読み取れる |
| EXEC-0071 | TC-050 保存失敗からの復旧・api | POST /api/v1/tasks→503 STORAGE_FAILURE、GET→200、POST→201、GET→200 | 権限を戻したあと再起動せず 201 になった実測。DEF-005 の修正確認 |
| EXEC-0088 | TC-061 悪意ある文字列・e2e/chromium | 一覧 4 行 [`"><svg onload=alert(1)>`、`&lt;b&gt;`、`<script>alert(1)</script>`、`<img src=x onerror=alert(1)>`]。入力欄は空。POST→201 ×4 | 4 件とも**文字列のまま行テキストとして表示**（要素・dialog にならない）ことを、表示テキストで確認できる |
| EXEC-0106 | TC-073 1,000 件の API・api | 一覧 p95 40.4ms（20 回、しきい値 1500ms）、追加 p95 27.0ms（10 回、しきい値 900ms）、追加後の一覧 1010 件・先頭「性能確認」・DB 1010 行 | しきい値（SLO の値の 3 倍）に対し 1/37・1/33 程度の実測 |
| EXEC-0107 | TC-074 1,000 件の画面・e2e/chromium | 表示完了 298ms、追加 316ms、完了切替 126ms、削除 189ms。しきい値は表示完了 6000ms・各操作 3000ms（係数 3） | 計測値は CI の通常値（追加 287〜411ms）の範囲 |
| EXEC-0111 | TC-077 backend 停止・compose | 保存エラー「保存できませんでした。もう一度お試しください」、POST→504、backend 停止中の health 504、backend 起動から health 200 まで 514ms | 停止中と復旧後の挙動と所要を実測 |

- **限界（正直に）**:
  - 観察値は**テスト終了時点**の画面と通信の記録で、途中の状態（エラー文言が出た瞬間など）は、テストのアサーションの成功で担保される。観察値だけでは確認できない行がある（例: EXEC-0084 TC-058 の観察値は再取得後の一覧 3 行で、手順 2 の「保存できませんでした」の表示そのものは載っていない）。**テストが見ていないことは書かれない**（`docs/evidence/README.md` の既知の制約）。
  - 観察値は機械が書いたもので、**人が画面を見て確認したものではない**。
  - 実機の 2 行（not_run）の観察値は「未実施のため観察値なし」。
- 実測値の質の検査（短すぎ・転記）は `execution-checks.mjs` の `checkActualResults`（CI の `docs-check` で毎回）。本書の数字は同じ基準で 2026-10-12 に数え直した。

## execution-06 証拠

**結論**: pass 109 行のすべてに、証拠が 2 件ずつ（JUnit のテスト結果 1・観察値 1）付き、証拠索引（285 行）に解決し、sha256 が 218 / 218 件一致する。日時・入力・通信・DB 行数・ログ件数は残るが、**画面キャプチャは取っていない**。

| 証拠の種類 | 何が残るか | 場所（実施表の `evidence_ids` → 証拠索引の `ref`） |
|---|---|---|
| 日時 | 各行の `executed_at`（ISO 8601、UTC、ミリ秒）と観察値の `started_at`・`finished_at` | `executions.csv`、観察値 JSON |
| 入力 | API の要求本文（例: `{"title":"<img src=x onerror=alert(1)>"}`）、入力欄の値、境界値の入力 → 結果の表 | 観察値 JSON（`api_calls`・`table`） |
| 画面 | 一覧の行（テキスト・チェック状態・通信中）、入力欄、エラー文言、フォーカス。**スクリーンショットは成功時には保存しない**（`e2e/playwright.config.js` は `screenshot: only-on-failure`）。失敗時の trace・video・screenshot は CI の artifact（90 日）にだけある | 観察値 JSON（`screen`） |
| 通信 | method・path・status・要求と応答の要約（上限 30 件） | 観察値 JSON（`api_calls`） |
| DB・ログ | DB の行数（例: TC-073 で 1010 行）、ログの level 50 以上の件数（TC-073 の期待は 0 件） | 観察値 JSON、JUnit |
| テスト結果 | 該当テストの成功（testcase 単位） | `docs/evidence/runs/38152472087/junit/*.xml` |

- **索引**: [evidence-index.csv](data/evidence-index.csv) の 1 行 = 1 つの主張（claim）と参照先（`ref`、`./docs/evidence/…#アンカー`）、`sha256`、取得日時、対象 SHA。例: EXEC-0001（TC-001・chromium）は EV-0273（JUnit `e2e-chromium-junit.xml#TC-001`、sha256 `064fb930…ca69d`）と EV-0274（観察値 `observations/e2e/TC-001.chromium.json`、sha256 `0551b409…649c`）。
- **集計**: 証拠索引 285 行のうち、実施表から参照されるのは 218（junit 109・observation 109）。pass 行の証拠 ID あり 109 / 109、索引に解決 218 / 218、sha256 一致 218 / 218（`check-evidence.mjs` の検査と、本書執筆時の再計算の両方）。not_run の 2 行には証拠が無い（実施していないため）。
- **保管先と改変防止の限界**:
  - 正本は **Git 履歴**（`manifest.json` が全ファイルの sha256・サイズ・取得元 run の URL・対象 SHA を持ち、`verify-manifest.mjs` と `docs-check` が不一致・欠落・未登録を**検知**する）。
  - **CI の artifact は 90 日で消える**（run 38152472087 は 2027-01-09 まで）。Release の添付 `release-evidence.zip` は期限が無い。ただし Release は immutable でない（`immutable: false`）。
  - **改変の防止は技術的には強制されていない**: main の Ruleset（force push・削除・非 linear の禁止）は**未適用**（ACT-008、期限 2026-10-16）。現状の防止は、PR のレビューと、sha256 による**検知**まで。第三者の署名・外部のタイムスタンプは無い。
  - 取り込んだ JUnit は CI の artifact と**バイト単位で同一**であることを、3 ファイル（`e2e-chromium-junit.xml`・`backend-junit.xml`・`frontend-junit.xml`）で確かめた（2026-10-12、`gh run download` の原本との sha256 の一致）。残りのファイルは、取り込みの仕組み（`fetch-run.mjs`）を信頼している。
- 個人情報・秘密情報は含めない（execution-12）。

## execution-07 不具合起票・関連付け

**結論**: 不具合表は 10 行。10 行すべてに再現手順・期待・実際・影響があり、証拠（Issue 起票の写し）がある。**実施表に fail 行は 0 件**（表は最終 run のみ）なので、fail 行から不具合へ張る関連付けは対象が無い。代わりに、修正済み 7 件のうち 4 件は、修正確認の pass 行（11 行）に `defect_ids` が付く。DEF の番号は Issue 番号（`DEF-005` = Issue #5）。

| 不具合 | 重大度 | 状態 | 関連ケース | 検出した工程 | 修正 commit |
|---|---|---|---|---|---|
| DEF-005 | major | fixed | TC-050 | api | bfebaee |
| DEF-006 | major | fixed | TC-061・TC-063・TC-020 | e2e | 72243c4 |
| DEF-011 | minor | fixed | TC-008・TC-046 | e2e | c3a6e84 |
| DEF-015 | minor | fixed | TC-031 | regression | 6fb219a |
| DEF-016 | minor | fixed | TC-075・TC-076 | monitoring | fd2b322 |
| DEF-025 | minor | **open** | TC-073 | api | — |
| DEF-031 | minor | **open** | TC-073・TC-074 | test（perf 層） | — |
| DEF-033 | minor | **open** | **無し**（CodeQL の検出。ケースが無い） | review | — |
| DEF-036 | minor | fixed | TC-008 | monitoring | 5fcf40a |
| DEF-037 | minor | fixed | TC-074・TC-073 | regression | 1abf247 |

（行の全項目は [defects.csv](data/defects.csv)。出典は main の同ファイル）

- **起票の要件**: `.github/ISSUE_TEMPLATE/defect.md` が、識別（検出工程・混入工程・重大度・機能・品質特性・対象版・上流文書）、再現手順、期待結果、実際の結果、影響、関連ケース・証拠、原因分類を必須にする。`build-defects.mjs` が Issue 本文の見出しと項目を読み、欠けていれば**失敗する**（事実に基づいて Issue を補筆してから再生成）。
- **関連付けの経路**: 不具合 → ケース（`case_ids`）→ 実施行（`traceability.csv`）。実施行 → 不具合（`defect_ids`）は修正確認の 11 行（DEF-005・006・011・015）。DEF-016・036・037 の修正確認の行には `defect_ids` が付いていない（関連ケースの pass 行からたどる）。**実施表と不具合表の双方向の対応は不完全**（依頼として報告）。
- **証拠**: 起票内容は `docs/evidence/github/defect-issues.json#issue-<n>`（証拠索引 EV-0001〜EV-0006 など）。修正済みの 7 件は、関連ケースが修正版で pass した JUnit の証拠も持つ。
- **未修正 3 件の扱い**（すべて minor。[01 テスト計画書](01-test-plan.md) の plan-12 は minor 5 件以下・Issue と期限と回避策・責任ロールを求める）: #25 は隔離の期限 2026-11-10、#33 は受容（AR-002・AR-003、期限 2027-01-09）、**#31 は Issue のコメント（2026-10-12 00:59 JST）に担当（バックエンド担当）・期限 2026-12-31・回避策が追記済み**（plan-12 が 2026-10-16 までに決めるとした分）。ACT-006 の期限は Issue と同じ 2026-12-31 に揃え、ACT-014（Issue への追記）は done にした。
- **ケースが無い不具合**: DEF-033（#33）は静的解析の検出でケースが無い。ケースの追加は ACT-011（QA リード、期限 2026-11-15）。DEF-036（#36）は外形監視が検出し、製品の変更時に監視の期待が追随しているかを確かめるケースが無かった（原因分類 process）。
- 不具合の状態は実施結果へ反映される: 修正済みの不具合の関連ケースは pass（execution-11）。未修正（DEF-025・031）の関連ケースが pass なのは、機能層の性能テストが**番兵**で、本判定は perf 層だから（DEV-005）。

## execution-08 Blocked／未実施管理

**結論**: blocked は 0 件。未実施（not_run）は 2 件（TC-071・TC-072。探索ケース、優先度 medium）。2 件とも理由・影響・解消 owner・再実施予定日が書かれている（実施表の `reason`・`owner`・`retest_due`、2 / 2）。ただし**実機と実施者の手配は未了で、予定日は暫定**。

| 項目 | TC-071（EXEC-0104） | TC-072（EXEC-0105） |
|---|---|---|
| 内容 | スクリーンリーダー（macOS の VoiceOver + Safari、Windows の NVDA + Firefox）の読み上げ | iPhone の Safari、日本語のソフトウェアキーボードでのレイアウトと変換確定 |
| 理由 | 読み上げの内容・順序・状態変更の通知は実機での聞き取りでしか判定できず、自動回帰の対象外。実機の実施記録が現時点で無い | ソフトウェアキーボード表示時のレイアウトと IME の変換確定は実機の WebKit でしか再現できず、自動回帰の対象外。実機の実施記録が現時点で無い |
| 影響 | RISK-007（アクセシビリティ）に関わる読み上げが**未確認**。REQ-009・REQ-010 | RISK-014（モバイル・IME）・RISK-007 に関わる実機の挙動が**未確認**。REQ-008・REQ-018・REQ-021・REQ-022。Playwright の WebKit・Pixel 5 のエミュレーションは補完にならない |
| 解消 owner（ロール） | QA 担当 | QA 担当 |
| 再実施予定日（`retest_due`） | 2026-10-31（**暫定**。リリース判定の日程が決まったら更新。確認先はプロダクトオーナー） | 同左 |
| 追跡 | ACT-004（open）、`docs/evidence/manual-plan.yaml` | 同左 |

- **リリース判断への反映**: v1.0.0 は、この 2 件を未実施のまま 2026-10-11T15:46:54Z に公開した。[01 テスト計画書](01-test-plan.md) の plan-12 は、**必須の未実施を 0 件**とし、任意・探索は理由・担当・実施予定日があれば**探索 2 件以内**で許容する。今回は 0 件・2 件で基準内。許容した残存リスクとして plan-12 の表（責任ロール QA 担当・期限 2026-10-31）に載っている。
- **解消の確認の仕方**: 実施したら、`manual-plan.yaml` の項目を外し、端末と版・観察した値・証拠つきの行を実施表へ pass / fail で足す（`build-executions.mjs` が not_run 行を作らなくなる）。期待と異なる点は不具合として起票する。予定日を過ぎたら、plan-12 は**未実施を許容しない**（期限の更新と再承認、または実施）。
- **正直なリスク**: 解消 owner の「QA 担当」は AI エージェントを兼ねるが、AI は実機のスクリーンリーダーも iPhone も操作できない。**実施には人の手と実機の手配が要り、2026-10-31 を守れる見込みは立っていない**（プロダクトオーナーに実施者と端末の手配を確認する必要がある）。

## execution-09 回帰結果

**結論**: v1.0.0 の回帰は**全件回帰**（選択なし）。選択 75 ケース（手動 2 を除く全件、除外したリスク 0）を、5 層 272 テストで実行し、失敗 0・skipped 0・再試行後の成功 0。結果は実施表（regression の 109 行）と一致する。

| 項目 | 内容 | 出典 |
|---|---|---|
| 回帰の範囲 | モード full。理由「push は全件回帰（選択しない）」。選択ケース 75、除外したリスク 0 | `docs/evidence/runs/38152472087/regression-selection.json` |
| 結果（層別） | compose 4/4、contract 8/8、e2e 43/43、unit 143/143、api 74/74（合計 272、失敗 0・skipped 0） | `ci-summary.json`、Release 本文 |
| 実施表との対応 | kind=regression の 109 行 = 75 ケース × 環境（pass 109）。手動 2 ケースは回帰の対象外（manual） | `executions.csv` |
| 回帰スイート | 77 ケースを tier で分類: smoke 5・pr 67・daily 3（TC-070・TC-073・TC-074）・manual 2。不具合の関連ケース 11 件（TC-008・020・031・046・050・061・063・073・074・075・076）に `defect_ids` が付く | `quality/regression-suite.csv`（main） |
| 変更影響による選択 | PR の CI は `quality/impact-map.yaml` に基づき実行ケースを選ぶ。push・タグは全件 | [quality/README.md](../quality/README.md) |

**main への push の CI の履歴（2026-10-11、UTC）**

| 時刻 | commit | 結果 | 備考 |
|---|---|---|---|
| 12:41 | 2c357a6 | **失敗** | TC-074 の追加が 1054ms でしきい値超過（偽陽性。#37）。原因はアプリの退行でなく共有ランナーの負荷 |
| 12:49 | 00dd983 | 成功 | |
| 12:59 | 1abf247 | 成功 | PR #38（番兵化）後。修正確認 |
| 15:39 | 5fcf40a | 成功 | PR #39。この commit が v1.0.0 |
| 15:43 | 5fcf40a（タグ v1.0.0） | 成功 | Release の全件回帰（run 38152472087）。実施表の元 |
| 15:59 | fcde92f | 成功 | PR #40（ドキュメントのみ） |

- 回帰の結果が実施表・品質報告（`docs/10-quality-report.md`。別担当が作成中で main に未追加）と一貫しているかは、品質報告が main に入った時点で突き合わせる（依頼として報告）。
- **限界**: 日次・週次の定期回帰（nightly）は main に入ったばかりで、履歴がまだ無い（[01 テスト計画書](01-test-plan.md) の plan-13）。flaky の隔離は 2 件（TC-073・TC-074、期限 2026-11-10）で、今回の run では両方 pass。

## execution-10 自動・API・性能結果の統合

**結論**: 自動・API・契約・compose の結果は、**1 つの run（38152472087）・1 つの SHA（5fcf40a）**に集約し、実施表から `run_ref` で参照している。性能（perf.yml。run 38152548008）は PR #61 で**取り込み済み**（[07](07-performance.md)）、外形監視は v1.0.0 のイメージに対する実行（schedule の通常実行 4 回と通知試験 2 回。2026-10-12 17:00 JST 時点）が Actions にあるが、**取り込んでいない**（[11](11-monitoring.md)）。集約の仕組みは自動化されている。

| 種類 | 結果 | run_ref・run | 対象 SHA | 実施表への取り込み |
|---|---|---|---|---|
| 自動（unit・e2e・compose） | unit 143・e2e 43・compose 4、すべて成功 | `gh-run-38152472087`（Release） | 5fcf40a（一致） | 取り込み済み（109 行のうち unit 36 行・e2e 40 行・compose 4 行） |
| API（backend の api 層）・契約 | api 74・contract 8、すべて成功 | 同上 | 同上 | 取り込み済み（api 27 行・contract 2 行） |
| カバレッジ | backend: 行 99.69%・分岐 98.09%・関数 98.78%、frontend: 行 100%・分岐 98.18%・関数 100% | 同上 | 同上 | `coverage-backend.json`・`coverage-frontend.json` |
| セキュリティ | ゲート pass、検出 12 件（medium 5・low 2・info 5） | 同上（security ワークフロー部分） | 同上 | 取り込み済み（`docs/evidence/security/`、`findings.csv`）。詳細は [08 テスト対象の検査結果レポート](08-inspection.md) |
| 性能（k6・画面計測） | **取り込み済み**（PR #61）。`perf.yml` の run 38152548008（タグ v1.0.0 上で 2026-10-11T15:44:35Z に手動起動）は success。想定負荷（20 req/s・1,000 件）で SLO 全達成（一覧 p95 19.5ms、表示完了 p95 158.1ms ほか）。全体判定 pass | 38152548008 | 5fcf40a | `docs/evidence/perf/` に取り込み済みで、証拠索引に載る（88 件）。参照先: [07](07-performance.md)、ACT-009（done）、[perf/README.md](../perf/README.md)。実施表（`executions.csv`）には載せない（perf 層の判定。TC-073・074 は番兵） |
| 外形監視（synthetic） | 2026-10-12 17:00 JST 時点で `synthetic.yml` の実行は 9 回: 手動の通常 2 回（成功 1・失敗 1。対象は 6572173・2c357a6 で v1.0.0 ではない）、通知試験 3 回（うち 2 回は v1.0.0 のイメージを digest 固定で起動）、**schedule の通常 4 回（v1.0.0 のイメージ、release モード、すべて 11/11 成功。間隔 3〜7 時間）** | 38141090678、38140285304（通常。参考）、38154528493・38155028980（通知試験）、38162078317・38178114415・38191254696・38220637289（schedule） | 6572173、2c357a6（通常）。通知試験・schedule は v1.0.0 のイメージ（`target.json` の `mode: release`、digest 固定。commit 5fcf40a） | **未取り込み**（`docs/evidence/monitoring/` は無い。取り込むかは未決。通知試験は成功率の根拠でない）。詳細は [11 外形監視・運用品質成果物](11-monitoring.md)、[monitoring/README.md](../monitoring/README.md) |

- **この版の結果として使わないもの**: `perf/results/` の既存の結果（20261011T082949Z-f948648 など）は v1.0.0 より前の commit・開発機（`local:darwin-arm64`）のもの。**v1.0.0 の性能結果としては扱わない**。
- **機能層の性能テスト**（TC-073・TC-074）は番兵で、実施表では pass（EXEC-0106・EXEC-0107）。SLO の本判定は perf 層で、v1.0.0 の runner 上の本計測と baseline は取り込み済み（PR #61。[07](07-performance.md)）。
- **集約の自動化と一貫性**: `summarize-junit.mjs` が層別の集計（`ci-summary.json`）を作り、`build-executions.mjs` が JUnit・観察値から実施表を作る。JUnit の層別の件数が `ci-summary.json` と違えば生成が失敗する。JUnit の層別の件数と Release 本文の層別結果は一致している（compose 4・contract 8・e2e 43・unit 143・api 74）。品質報告（DOC-10）との一致は、execution-09 と同じく main に入ってから確認する。
- 実施表の e2e が 40 行、JUnit の e2e が 43 テストと差があるのは execution-04 に書いたとおり。

## execution-11 修正確認

**結論**: 修正済み 7 件すべてで、修正 commit が v1.0.0 の commit の祖先であり（DEF-036 は 5fcf40a 自身）、関連ケースが v1.0.0 の run で pass している（修正版での再実施）。周辺条件の確認と、再発しないことの確認の深さには差がある。修正確認は回帰スイートに組み込まれている（関連 11 ケースに `defect_ids`、全件回帰で毎回再実施）。

| 不具合 | 修正 commit（v1.0.0 の祖先） | 再実施の結果（実施表） | 周辺条件・同種の確認 | 確認の深さ |
|---|---|---|---|---|
| DEF-005 | bfebaee（○） | TC-050 api pass（EXEC-0071）。権限を戻したあと再起動せず POST→201 | 同じ DB 異常系の TC-052（破損 DB）も pass（関連ケースではなく、全件回帰の結果） | 修正版で再現しないことを確認 |
| DEF-006 | 72243c4（○） | TC-061・TC-063・TC-020 の 5 行 pass（EXEC-0028・0088・0089・0091・0092） | 同じ画面の連続追加・連打・同名追加を併せて確認（関連ケース 3 つ） | 周辺条件まで確認 |
| DEF-011 | c3a6e84（○） | TC-008・TC-046 の 4 行 pass（EXEC-0011・0012・0065・0066） | 完了切替の通信中と保存失敗の両方（unit・e2e） | 周辺条件まで確認 |
| DEF-015 | 6fb219a（○） | TC-031 api pass（EXEC-0048）。POST→422 TITLE_TOO_LONG ×3 | bodyLimit の不安定さが再発しないか（再試行 0 で pass） | 1 回の pass |
| DEF-016 | fd2b322（○） | TC-075（api・contract）・TC-076（compose）の 3 行 pass（EXEC-0108・0109・0110） | rollback 訓練で health の commit が良い版に戻ることも確認（`monitoring/drills/20261011T1220Z-rollback-after-16fix/`） | 周辺条件まで確認 |
| DEF-036 | 5fcf40a（自身） | TC-008 の 2 行 pass。ただし**このケースは外形監視の期待を確かめない**。監視の回復は synthetic の別 SHA（6572173、run 38141090678）で確認した | 監視の変更の追随を確かめるケースは無い（ACT-011） | **製品の SHA では確認できていない** |
| DEF-037 | 1abf247（○） | TC-074・TC-073 の 2 行 pass（EXEC-0107・0106） | 週次の `--repeat-each=3` で混在が無いことの確認は未了（ACT-012、期限 2026-11-10） | 1 回の pass（flaky は 1 回では確定しない） |

- 祖先の確認は `git rev-list --ancestry-path <修正 commit>..5fcf40a7e5…` で行った（2026-10-12）。
- 未修正 3 件（DEF-025・031・033）は修正確認の対象外。DEF-025・031 の関連ケースの pass は、番兵の通過であり、不具合の解消を意味しない。

## execution-12 Data・環境保全

**結論**: テストごとの独立したデータと後始末の設計があり、実施表・観察値に秘密情報・個人情報らしい値は無い（116 ファイルの走査で 0 件）。**後始末を実行した記録は実施表に残らない**（設計と CI の使い捨て環境に依存）。データは実在の個人情報・本番データを使わない合成データのみ。

- **case 間の汚染の防止**: e2e は各テストが専用の backend プロセス・一時 DB（`mkdtemp`）・空きポートを持つ（`e2e/fixtures/stack.js`）。api・unit も同様に一時ディレクトリの DB を新しく作る。compose は専用プロジェクト名 `todoapp-e2e` と空きポートで、**各テストの前後に `down -v`**（直列、workers=1）。再試行は 0 で、失敗を隠して状態を引きずらない。
- **後始末**: 全 77 ケースが `cleanup`（後始末）を記載。一時ディレクトリの削除、`docker compose down -v`、ブラウザコンテキストの破棄、書込み不可の DB（DS-008）を `chmod 0644` に戻してから削除（`finally`）。GitHub-hosted runner は**ジョブごとに使い捨て**の環境で、ジョブ終了時に破棄される。開発機の実行はテストコードの後始末に依存する。
- **秘密情報・個人情報**: データは合成（架空の日常語・連番・攻撃文字列の例）で、人名・社名・メール・電話番号を含まない。観察値は短く（行数 10・タイトル 40 文字・呼び出し 30 件）、UUID は伏せる。本書執筆時に、実施表・観察値 JSON・JUnit の 116 ファイルへ、メール・電話・トークン・秘密鍵・認証情報の代入・カード番号の正規表現を当てたところ、**0 件**。`check-evidence.mjs` が `docs/data/` と `docs/evidence/` 全体に同種の検査を CI で毎回行い、gitleaks が履歴全体を検査する。
- **データ分類**（`docs/evidence/README.md`）: **public**（リポジトリは public。利用者データは含まない）。**internal** に当たるものは置かない。SBOM には第三者パッケージの公開メタデータのメンテナ宛先があり、原本の sha256 を保つため伏字にしていない（実施データではない）。
- **匿名化規則・後始末の自動化**: 匿名化の対象となる本番データが無いので、匿名化の規則は定めていない（使う場合は、利用前に規則と責任者を [01 テスト計画書](01-test-plan.md) の plan-08 に足す）。観察値の短縮・UUID の伏せ字と、証跡の走査は自動。
- **限界**: 正規表現の検査は**不在を証明しない**。最終確認は人が行う（観察値は目視できる大きさ）。外形監視のデータ（`synthetic-<run_id>-MON-xxx`）の後始末は運用（SRE）担当で、本書の実施表の範囲外。

## execution-13 進捗・重大異常の共有

**結論**: 重大な異常（critical）は 0 件。major の 2 件（#5・#6）は、起票から修正まで 3 分 24 秒と 16 分 12 秒で Issue に共有された。共有は GitHub の Issue・PR・Release が中心で、**宛先は実質プロダクトオーナー 1 名**。外部の通知基盤（メール・チャット）は無く、**定期の進捗報告は無い**（実施期間が 1 日と短い）。受け手が判断に使えたかの独立した確認は無い。

**報告の宛先（recipients）**: プロダクトオーナー（リポジトリオーナー）。経路は GitHub（Issue・PR・Actions の通知。ラベル `defect`・`flaky`・`incident`・`security`）。

| 報告した日時（reported_at。UTC） | 内容 | 経路 | 結果・反映 |
|---|---|---|---|
| 2026-10-11T06:40:23Z | major の不具合 #5（SQLite 接続が権限を戻しても書込み不可のまま） | Issue | 06:43:47Z に修正してクローズ（3 分 24 秒） |
| 2026-10-11T06:42:19Z | major の不具合 #6（送信中の次の入力が消える） | Issue | 06:58:31Z に修正してクローズ（16 分 12 秒） |
| 2026-10-11T07:02:39Z、07:25:02Z、07:26:21Z | minor の #11・#15・#16 | Issue | #11 は 07:08Z、#15 は 07:46Z、#16 は 12:37Z にクローズ |
| 2026-10-11T08:30:02Z | #25 TC-073 が共有ランナーで不安定（flaky） | Issue | 隔離（期限 2026-11-10）。open |
| 2026-10-11T12:17:27Z | #31 性能: 1 要求のコストが件数に比例し CPU 飽和 | Issue | open。改善案 A〜D。起票時は期限なし。15:59:29Z（2026-10-12 00:59 JST）のコメントで担当・期限 2026-12-31・回避策を追記 |
| 2026-10-11T12:44:12Z | #36 外形監視 MON-008 の誤検知（incident、sev2） | Issue（synthetic.yml が自動起票） | 12:56:26Z に回復を確認して自動クローズ（約 12 分）。是正は PR #39 |
| 2026-10-11T12:41Z〜12:51:19Z | main の CI が赤（TC-074 の偽陽性）。10 分後に #37 を起票 | Actions の通知、Issue | 12:59:54Z に PR #38 で修正・クローズ |
| 2026-10-11T15:46:54Z | Release v1.0.0（層別結果 272 テスト失敗 0、digest、検査の要約） | Release 本文 | 公開 |

**計画との乖離（deviations）**

- 基準（[01 テスト計画書](01-test-plan.md)）は**リリースの後に成文化**した（リリース時点では基準が文書になっていなかった）。
- バッファは計画に無く、修正確認の追加 PR（#35・#38・#39）が実質のバッファを消費した（plan-10）。
- 手動 2 ケース（TC-071・TC-072）は未実施（execution-08）。
- 初回の GitHub Actions 実行で出た 2 件（k6 の出力権限、MON-008 の誤検知）の修正 PR #39 が、リリース直前に必要になった。
- 性能の runner 上の baseline は 1 回の run から作った（PR #61。run 間のノイズは分からない。execution-10）。

**重大欠陥（critical_defects）**: critical は 0 件。major は #5・#6 の 2 件で、修正済み。minor の未修正は 3 件（#25・#31・#33）。データ損失・破損の自動上書きに当たる未修正はなし。

- **受け手が判断に使えたか**: プロダクトオーナーのコメントとマージ（例: #16・#36・#37 の補筆と修正 PR の記録）は、受領と対応の事実を示す。しかし**受け手が自分のコメントの作者と同じ主体**で、報告が適時だったか・判断に使えたかを独立に確認した記録は無い（人の確認が要る）。
- **改善**: 次のリリースでは、リリース前に乖離（未実施・未修正・暫定の予定日）を 1 つの Issue か PR にまとめて共有する。

## execution-14 第三者追認可能性

**結論**: 別の reviewer が、実施表と証拠だけで合否を追認できる**手順と材料は揃っている**。**人による第三者の追認は実施していない**（独立した第二のレビュアーがいない。[01 テスト計画書](01-test-plan.md) の plan-09）。代わりに、実施者（CI）とは別の機械的な再計算を行い、結果を下に正直に記す。

**追認の手順**（reviewer が 30 分程度で再現できる粒度）

1. 対象版を確認する: `executions.csv` の `commit_sha` が 1 種類で `release.json` の `commit_sha` と一致し、Release 本文の digest が `release.json` と一致すること。
2. 証拠の完全性を確認する: `node scripts/evidence/verify-manifest.mjs` と `node scripts/evidence/check-evidence.mjs --strict`（manifest の sha256、証拠索引の参照とハッシュ、実施表の規則、秘密混入を検査）。
3. 行を 1 つ選び、`evidence_ids` → 証拠索引の `ref` → ファイルを開く。JUnit の該当 testcase に failure・error・skipped が無いこと、観察値の `outcome` が passed で `run.commit_sha` が行と同じことを見る。
4. 観察値の中身（画面・入力・通信・計測）を `cases.csv` の期待結果と読み比べ、合否を自分で判断する（`actual_result` は観察値の要約）。
5. 取り込みの正しさを確認する: `gh run download 38152472087 -n e2e-evidence-chromium` などで CI の原本を取り、`shasum -a 256` が証拠索引と一致すること（artifact は 2027-01-09 まで）。
6. 判定を突き合わせる: pass 109・not_run 2・fail 0 の集計と、Release 本文の層別結果。

**追認の試行**（2026-10-12、QA 担当（AI）が実施。**独立した第三者ではない**）

| 確認 | 結果 |
|---|---|
| 手順 3 の機械的な再計算（pass 109 行 × 証拠 2 件） | 証拠 218 / 218 件でファイルが存在し sha256 が証拠索引と一致。JUnit の該当 testcase が failure・error・skipped なしで成功 109 / 109 行。観察値の outcome が passed 109 / 109 行。観察値の commit が行の commit と一致 109 / 109 行 |
| 手順 5（CI の原本との一致） | 3 つの JUnit（e2e-chromium・backend・frontend）が `gh run download` の原本とバイト単位で一致 |
| 手順 2（`check-evidence.mjs`。main のスクリプトを PR #42 の CSV へ適用） | 実施表（111 行・pass 109・観察値あり 109）・証拠索引（285 行）・manifest（277 件）・ID 参照・パリティは PASS。ただし**別の 3 検査は FAIL**（不具合表の DEF-033 の `case_ids` が空、追跡表の再生成差分、gitleaks の SARIF のメール様の文字列 2 件の誤検出）。PR #42 は検査側の更新（ケースの無い不具合の扱い、SARIF の許可リスト。コミットの題名による）を含み、その CI（`docs-check`）は成功している |
| 手順 4（人による読み比べ）| 6 行（execution-05 の例）を期待結果と読み比べ、観察値から合否を判断できた。**途中状態を観察値が持たない行は、アサーションの成功に頼る**（EXEC-0084 など） |

- **限界（正直に）**:
  - 再計算に使った追加の検査（JUnit の成否・観察値の outcome と commit の突き合わせ）は、作業用のスクリプトで行い、**リポジトリには入れていない**。`scripts/evidence/` に常設する提案を、最終報告に依頼として書く。
  - 画面キャプチャが無いため、人が目で見て確かめる材料は観察値のテキストに限られる。
  - 実施者（CI）・不具合の起票者・本書の作成者・承認者が同じ主体の兼務で、**真の第三者の追認ではない**。追認の実施記録（追認した人・日時・サンプル・結果）は、人が行った時点で本章へ足す。
  - 実機 2 ケースは、そもそも合否が無い（not_run）。
