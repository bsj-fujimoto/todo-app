# 05 自動テスト成果物

| 項目 | 内容 |
|---|---|
| 文書ID | DOC-05 |
| 版 | 1.0 |
| 更新日 | 2026-10-12 |
| 状態 | draft（マージ後に reviewed へ。承認の扱いは下記） |
| 対象 | todo-app 仕様書 v1.1（spec/todo-phase1-spec.html）、リリース v1.0.0（commit 5fcf40a7e58dc253e53ff56860d0669a69abda26） |
| 作成 | QA 担当（ロール。実作業は AI エージェント） |
| レビュー | QA リード（未実施。作成者と別ロールだが兼務で、第二の目は無い） |
| 承認 | プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ。マージ前は未承認） |
| 正本 | この md と、`backend/test/`・`frontend/test/`・`e2e/`（fixtures・tests・compose）、`eslint.config.js`、`.github/workflows/ci.yml`・`nightly.yml`、`.github/CODEOWNERS`、`.github/settings/ruleset-main.json`、`quality/flaky-ledger.yaml`、`scripts/ci/`（Git が版管理） |

本書は、**反復して実行できる検証を、速く・安定して・保守できる形で動かし、PR とリリースの判断に接続している**ことの方針・実績・できていないことをまとめる。本数やコードカバレッジを品質の指標にせず、重要リスクへの速いフィードバック、安定性、診断のしやすさ、保守の費用で示す。
ケースの行は `docs/data/cases.csv`、テストの置き場所と TC-ID の対応は [03 の 13.3](03-test-spec.md)、回帰運用（層・選択・隔離台帳）は [04](04-regression.md) と [quality/README.md](../quality/README.md) が正本で、本書は重複を避け、**自動化の設計・品質・ゲート・健全性**を書く。
数字は出典（パス・Issue・PR・run）を付けた。数えた日時は 2026-10-11 16:12 UTC（= 2026-10-12 01:12 JST）で、時間とともに変わる値は出典で数え直す。run 38152472087 の中身（`ci-summary.json`・カバレッジ・JUnit）は、`docs/evidence/runs/38152472087/`（実施表・不具合表の再生成と同じ取り込み。main に入るまでは `evidence/release-v1.0.0` ブランチ）にある。

## 結論

- **層と件数**（Release run 38152472087、全件、失敗 0）: unit 143・api 74・contract 8・e2e 43（4 project の実行の合計）・compose 4 の**計 272 実行**。分布は unit 52.6%・api 27.2%・contract 2.9%・e2e 15.8%・compose 1.5% で、e2e は unit の 0.30 倍（逆ピラミッドではない）。
- **自動化率** 97.4%（75 / 77 ケース）。必須ケース 66 件は**すべて自動**。high のリスク 3 件（RISK-001・RISK-003・RISK-004）のケース 36 件（重複を除くと 31）もすべて自動（automation-08）。
- **コードカバレッジ**: backend 行 99.69%・分岐 98.09%、frontend 行 100%・分岐 98.18%（行のしきい値 90% を下回ると失敗する）。
- **決定性**: 時刻・乱数・ID 採番は注入し、`Date.now`・`Math.random`・`crypto.randomUUID`・引数なしの `new Date()` を ESLint が禁止する（CI の lint ジョブが違反を止める）。テストは専用の一時 DB・空きポートを使い、固定の待ち時間を使わない。
- **ゲート**: required checks は集約ジョブ `ci-result`（8 ジョブすべての success を要求。skipped・cancelled も失敗扱い）と `security-result`。`continue-on-error` は 0 箇所。**Ruleset の定義はあるが、本書の作成時点では GitHub に適用されていない**（automation-06。時点の事実は出典で確認する）。
- **flaky**: `retries: 0`。隔離台帳は 2 件（TC-073・TC-074、期限 2026-11-10）で、期限切れ 0。週次の 3 回繰り返しによる検出は**実績 0 回**。
- **フィードバック時間**: CI の成功 45 run で中央値 161 秒・p95 234 秒・最大 458 秒（宣言上限は 10 分）。
- **できていないこと（正直に）**:
  - **運用期間がまだ短い**。run は 2026-10-11 の約 9 時間に集中し、4 週間に満たない。**日次・週次（`schedule`）の実績は 0 回**で、成功率・flaky 率・実行時間の時系列分析は成立しない（automation-13）。
  - **Ruleset が未適用**のため、required checks・承認・force push 禁止は GitHub 側で強制されていない（設計と運用ルールで補っている。automation-06）。
  - アサート無しのテストを機械で検出する仕組み、ミューテーションテストは無い（automation-05）。
  - 単独のリポジトリオーナー + AI エージェントの体制で、テストの所有・SLA の合意は**兼務の自己合意**にとどまり、第二の目・不在時の代理は置けない（automation-12）。

## automation-01 自動化目的・範囲

**結論**: 自動化の目的は、**回帰確認の人手を無くし、受け入れ条件と high リスクの退行を PR とリリースの前に止める**こと。77 ケースのうち 75 件を自動化し、自動化しないのは実機の 2 件だけ。

**目的（purpose）**

1. 回帰確認を機械に任せ、変更のたびに全件を数分で回す（main への push の全件回帰は成功 12 run で 141〜306 秒）。
2. 受け入れ条件 AC-01〜AC-07 と必須 66 ケース、high リスクの 31 ケースの退行を、マージ前・マージ後・リリース前に止める。
3. 互換（chromium・firefox・webkit と 360px）を、毎回同じ手順で確かめる。
4. 実施の証拠（対象 SHA・結果・観察値）を機械的に残し、実施表（`docs/data/executions.csv`）を再生成できるようにする。

**自動化の対象（in_scope）**

| 層 | ツール | 対象 |
|---|---|---|
| unit | node:test、happy-dom | 検証関数の境界値、状態遷移、描画関数、設定の読み取り |
| api | node:test + 実 Fastify + 実 SQLite | 入力検証、状態遷移、保存失敗、データ破損、並行、永続化、health |
| contract | Ajv（`openapi.yaml` をそのまま使う）+ redocly + oasdiff | 応答が契約に従うこと、破壊的変更の検出 |
| e2e | Playwright（4 project）+ axe-core | 受け入れ条件、画面状態、a11y、360px、3 ブラウザ互換 |
| compose | Playwright（専用の compose プロジェクト） | 起動・永続化・ボリューム・停止検知 |

**自動化しないもの（out_of_scope）と理由（reason）**

| 対象外 | 理由 |
|---|---|
| 実機のスクリーンリーダー（TC-071）、実機 iOS Safari の画面キーボードと日本語入力（TC-072） | 実機でしか判定できない（axe-core は名前の有無までで、Playwright の WebKit は画面キーボードも IME も再現できない）。**未実施**で、期限は 2026-10-31（`docs/evidence/manual-plan.yaml`） |
| 見た目（色・位置）のピクセル比較（ビジュアル回帰） | 仕様書に色・位置の数値が無く、比較の基準を作れない（[ai-context.yaml](ai-context.yaml) の `contradictions.items_not_compared`）。コントラスト・名前・キーボードは axe-core とケースで確かめる |
| 認証・認可の API 試験、SEO・AIO、認証付き外形監視、ページング、版の組み合わせ互換 | 承認済みの対象外（[01 の plan-03](01-test-plan.md)。承認はマージ時） |
| 負荷・性能の本判定、外形監視、セキュリティ検査 | 別の層（perf.yml・synthetic.yml・security.yml）で行う。機能層の TC-073・TC-074 は番兵（[ADR-0005](adr/0005-functional-layer-perf-sentinel.md)） |

**投資判断（何を優先して自動化するか）**

- 優先順位: ① high リスク（RISK-001・003・004）のケース → ② 重要ジャーニー J-01〜J-05（37 ケース）→ ③ その他の必須 → ④ 任意。費用の小さい層（unit → api）から作り、画面操作（e2e）は受け入れ条件・画面状態・互換に絞る。
- 投資を絞った例: 3 ブラウザで回すのは、互換のケース（`@cross-browser` の TC-001・TC-056・TC-070 の 3 本）だけ。そのほかは chromium のみ。
- 自動化の費用と効果: 自動化しなかった 2 件は、自動化の費用（実機の用意・IME の再現）が効果を上回るため手動に残した。自動化の進捗は `quality/known-gaps.yaml`（自動化するはずで未実装のケース。現在 0 件）で期限つきで公開する。
- 見直し: 実機を借りられる・WebKit で再現できるようになったら TC-071・TC-072 を再検討する（regression-09）。

## automation-02 レイヤー・アーキテクチャ

**結論**: 5 つの層（unit・api・contract・e2e・compose）に責務を分け、**ピラミッド型**（unit 143 > api 74 > e2e 43）の分布になっている。e2e の件数が unit を超えたら見直す、を基準にしている。

| 層 | 責務（ここで確かめる） | 置かないもの | 件数・割合 | 所要（合計） |
|---|---|---|---|---|
| unit | 検証関数の境界値、状態遷移、描画関数のエスケープ、設定の読み取り。DB・ブラウザを使わない（frontend は happy-dom で画面ロジックも見る＝component 相当。layer の集計では unit に含む） | 通信・永続化・画面の実描画 | 143（52.6%） | 0.56 秒 |
| api | backend の入力検証・状態遷移・保存失敗・データ破損・並行・health・永続化。実 HTTP と専用の実 SQLite | ブラウザの描画 | 74（27.2%） | 13.2 秒 |
| contract | 応答が `backend/openapi.yaml` のスキーマに従うこと（Ajv）。lint と破壊的変更の検出は CI の別ステップ | 業務ロジックの網羅 | 8（2.9%） | 0.77 秒 |
| e2e | 画面操作を通した受け入れ条件・画面状態・a11y・360px・互換。実ブラウザ + 実 backend プロセス + 実 SQLite | 境界値の網羅（unit・api に置く） | 43（15.8%。chromium 36・chromium-mobile-360 1・firefox 3・webkit 3 の実行の合計。異なるテストは 37 本） | 51.1 秒（4 project の合計） |
| compose | 本物の nginx・コンテナ・ボリュームでの起動・永続化・停止検知。直列（workers=1） | 画面の網羅 | 4（1.5%） | 101.2 秒 |

（出典: Release run 38152472087 の `ci-summary.json`、[03 の 13.1](03-test-spec.md)。ケース数の分布〔unit 10・api 27・e2e 38・manual 2〕は「ケースの主たる層」で数えたもので、**実行数の分布とは別の指標**である。境界値は 1 ケースが多数の入力を流すため、実行数は unit が多くなる）

**どの層に何を置くか（基準）**

1. 純関数で確かめられるものは unit に置く。同じ入力表を frontend と backend の検証関数の両方に流す（TC-021〜TC-029）。
2. HTTP の入出力・保存・障害・並行は api に置く（専用の SQLite で、書込み不可・破損・再起動を再現する）。
3. 画面を通さないと確かめられないもの（受け入れ条件の通し、画面状態、a11y、互換）だけを e2e に置く。互換の 3 ブラウザは `@cross-browser` タグのケースだけ。
4. 外部の環境（nginx・ボリューム・コンテナ起動）が要るものだけを compose に置く。
5. 同じ振る舞いを複数の層に置くときは、層の違う別の検証にする（例: DEF-006 の回帰は、frontend の単体と e2e の両方に置いた）。

**分布の見直し**: `ci-summary.json` の `layers` が run ごとに分布を出す。基準は、e2e の実行数が unit の件数を超える（逆ピラミッド）、または e2e の所要が全体の半分を超えること。現在は e2e が 15.8%、unit が 52.6%。**見直しの実績はまだ無い**（運用 1 日）。次回は四半期の棚卸し（regression-10）で見る。

## automation-03 テストコード品質

**結論**: テストコードにも**本番コードと同じ ESLint・prettier・PR の経路**が掛かる。緩めているのは「1 関数の行数」「1 ファイルの行数」だけ（`describe`/`it` の入れ子で長くなるため）。

**レビュー（review）**: すべてのファイルが CODEOWNERS の既定の所有者（`*`）の対象で、`code owner review` を Ruleset が要求する設計。PR テンプレートに「追加・変更した振る舞いに、ケース ID（TC-xxx）を持つ自動テストがある」「CI が緑」を持つ。**実態は単独のオーナー + AI で、独立した第二のレビュアーは居ない**（ADR-0004、automation-06）。レビューで欠陥を見つける効果は、CI と自己レビューに頼っている。

**命名（naming）**: テスト名の先頭に `[TC-xxx]` を付ける。ケース外の補助の検査は `[補助]` を付ける（run 38152472087 の backend の JUnit は testcase 103 件で、うち名前に `[補助]` を持つものが 50 件）。名前は日本語で期待する結果を書く（例: 「[TC-050] 追加は 503 STORAGE_FAILURE で DB に一切書かれず、権限を戻すと同じ操作が 1 回だけ成功する」）。名前の TC-ID が `cases.csv` に実在すること、自動化ケース 75 件がすべてテストに対応することを、docs-check の `tc-coverage` が CI で検査する。

**共通化（shared_helpers）**

| 置き場所 | 内容 |
|---|---|
| `backend/test-support/` | `sandbox`（専用ディレクトリ・後始末）、`db`（seedTasks・corruptDbFile・readRows）、`datasets`（DS-002 などの固定データ）、`process`（実プロセスの起動）、`clock`（固定の時刻・連番 ID）、`observe*`（観察値の採取）。e2e からも使う |
| `backend/test/helpers/` | `harness`（api テストの土台。専用 DB・固定 clock・全応答の契約検証）、`assertions`（エラー封筒の検査）、`contract`（Ajv による契約検証） |
| `e2e/fixtures/` | `stack`（テストごとの専用スタック）、`todo-app`（画面の操作・取得を、ラベル・ロール・アクセシブルネームで引く）、`gate`（応答を条件で保留する）、`observe` |
| `frontend/test/unit/dom.js` | `index.html` を happy-dom に読み込む |

**静的解析（static_analysis）**: `eslint.config.js` の規約（複雑度 8・引数 4・ネストの深さ 3・`eqeqeq`・`no-console` など）は**テストにも適用**される（緩めるのは `max-lines-per-function` と `max-lines` だけ）。`npm run lint` と `npm run format:check` は CI の lint ジョブで、`ci-result` の必須条件。テストの道具自体（CI・回帰・証跡）にも単体テストがある（`scripts/test` 68 件・`scripts/evidence/test` 54 件。2026-10-12 の手元実行で全件 pass。CI の lint ジョブで実行）。

**可読性（readability）**: 1 ファイル 1 機能（`add-task.spec.js`・`toggle-delete.spec.js`・`storage-failure.test.js` など、[03 の 13.3](03-test-spec.md) に対応表）。画面の操作は `TodoApp` に集め、テスト本体に CSS セレクタを散らさない。テストコードは 34 ファイル（backend 18・frontend 5・e2e 11）、補助を含めて約 5,200 行。

**限界**: 重複したテストの機械的な検出、テストコード専用のレビュー基準（チェックリスト）、変更に対するミューテーションは無い。

## automation-04 決定性・データ独立性

**結論**: 時刻・乱数・ID・ポート・データを**注入または専用に作る**ことを規約にし、**違反を ESLint が CI で自動検出する**。非決定になりうる呼び出しは、計測と条件待ちの数か所に限り、固定の待ち時間は使っていない。

**決定性の規約と自動検出**

| 規約 | 検出 | 出典 |
|---|---|---|
| 現在時刻は `clock` として注入する（`Date.now()`・引数なしの `new Date()` を禁止） | ESLint の `no-restricted-properties` / `no-restricted-syntax`。違反は lint ジョブで失敗 | `eslint.config.js` |
| 乱数は注入する（`Math.random` を禁止） | 同上 | 同上 |
| ID 採番は `idGenerator` として注入する（`crypto.randomUUID` を禁止） | 同上 | 同上 |
| 例外は composition root だけ（`backend/src/main.js`・`frontend/src/main.js`）、CLI の入口（`scripts/*/*.mjs`）、外形監視（`e2e/synthetic/`）、k6 | `eslint.config.js` の `files` 指定で明示 | 同上 |

- 注入の実体: `buildApp({ clock, idGenerator })`。テストは `fixedClock`・`steppingClock`・`sequentialIdGenerator`（UUID v4 形式の連番）を渡す（`backend/test-support/clock.js`）。api テストの既定の時刻は `2026-10-05T10:00:00.000Z`。id は固定の UUID リテラル。
- データの独立: テストごとに専用の一時ディレクトリ・専用の SQLite・空きポート（`PORT=0`）を作り、`afterEach` / `finally` で後始末する。固定ポート・固定の絶対パス・共有のデータを使わない（[03 の 12 章](03-test-spec.md)）。compose は専用のプロジェクト名で、前後に `down -v`。
- 並列: node:test は既定の並列度、Playwright は `fullyParallel: true`。専用のスタックを持つので並列でも汚染しない。compose だけ直列（workers=1）。

**残っている非決定な呼び出し（正直に）**（2026-10-12 に `grep` で数えた。テストコード・fixtures・test-support が対象）

| 種類 | 件数 | 内容 |
|---|---|---|
| `Date.now`・`new Date()`・`Math.random`・`randomUUID` | 0 | — |
| `performance.now()` | 12 箇所 | 応答時間の計測（TC-073・TC-074・TC-042。合否は番兵のしきい値で、CI は 3 倍）、起動待ちの締切の計算（実プロセスの起動・compose の health 待ち）、観察値の記録時刻（`backend/test-support/observe.js`。**記録であって判定ではない**） |
| `setTimeout` / `sleep` | 6 箇所 | 条件待ちの上限（ログが出るまで・起動するまでのタイムアウト。出れば即座に終わる。`backend/test-support/process.js` 2・`e2e/fixtures/backend-process.js` の強制終了 1）、締切つきの確認の繰り返し（`backend-process.js` の 50ms 間隔、compose の health 待ちの 500ms 間隔の 2 箇所）、観察値の採取の上限（`e2e/fixtures/observe.js` 1）。**固定の待ちで結果を決める箇所は無い**（`waitForTimeout` も 0）。ログの確認は `waitForLog` |

**揺れの実績と対処**: 絶対時間のしきい値が共有ランナーで揺れた（#25・#37）→ 機能層を番兵にして CI は 3 倍、本判定は perf 層（[ADR-0005](adr/0005-functional-layer-perf-sentinel.md)）。DEF-015 の修正では、並列度・CPU 負荷を変えて backend の全テストを **315 回**繰り返し、失敗 0 を確かめた（PR #21。`TEST_CONCURRENCY` で並列度を変えられる）。#37 の修正では、chromium・webkit・mobile を `--repeat-each=10 --workers=8` で、CPU 負荷あり・なしとも 400 件 pass を確かめた（Issue #37）。

**できていないこと**: 週次の `--repeat-each=3`（実績 0 回）による CI 上の混在検出。`performance.now()` と `setTimeout` を ESLint で禁止はしていない（計測・待機に必要なため、レビューで見る）。

## automation-05 アサーション・Oracle

**結論**: 「何が正しいか」（Oracle）は、**仕様書・API 契約・テスト仕様書に明文化**し、テストは**具体的な値**で検証する。アプリ本体を mock で置き換えず、mock ライブラリ・スナップショットの使用は 0 件。

**Oracle の所在（明文化）**

| 何を | Oracle | 検証の方法 |
|---|---|---|
| 画面の文言・検証規則・状態遷移 | 仕様書 v1.1（spec/todo-phase1-spec.html）、[03 の 5 章・8.2](03-test-spec.md) の期待結果、`cases.csv` の `expected_result` | テスト側に**文言をリテラルで持つ**（`backend/test/helpers/assertions.js` の `MESSAGES`、`e2e/fixtures/todo-app.js` の `MESSAGE`）。実装の定数を import せず、実装の誤りを検出できる |
| API の入出力・エラー封筒 | `backend/openapi.yaml`（契約先行） | 契約に載る operation への応答は、**api テストの土台がすべて Ajv で契約検証**する。契約外の応答・本文は落ちる（`backend/test/helpers/contract.js`） |
| 永続化 | DB の行そのもの | `readRows` で行を読み、失敗前後のファイルの SHA-256 を比べる（TC-050〜TC-054） |

**具体的な検証の例**

- TC-050: 503 と `STORAGE_FAILURE` と**仕様書どおりの文言**、一覧が変わらない、DB ファイルの SHA-256 が失敗の前後で同一、error ログがちょうど 1 件、権限を戻して再試行すると行数が 4 になり**重複しない**、まで確かめる。戻り値だけで終わらない。
- TC-031: 101 文字・絵文字 101 個・10 万文字のすべてで 422 `TITLE_TOO_LONG`、backend が落ちない、DB の行が変わらない。
- TC-061（e2e・unit）: 送信中に打った次の入力が残ること、一覧が期待どおりであること。

**mock の方針**

| 場所 | 実物か | 補足 |
|---|---|---|
| api | 実 Fastify + 実 SQLite（専用ファイル）+ 実 HTTP | mock なし |
| e2e | 実ブラウザ + 実 backend プロセス + 実 SQLite + 画面の配信サーバー | 障害の注入だけ `page.route`（通信の保留・遮断・503 応答。5 ファイル 8 箇所）。アプリ本体は実物 |
| compose | 本物の nginx・コンテナ・ボリューム | mock なし |
| frontend の unit | API クライアントを関数で注入して差し替える | 単体の境界。通信そのものは `api-client.test.js` で検証 |

mock ライブラリ（jest・sinon・`mock.fn` など）とスナップショット（`toMatchSnapshot` など）の使用は 0 件（2026-10-12 に grep）。アサーションの行は約 790（`assert.` と `expect(`）。テストが実際に観察した値は `observe` で記録し、実施表の `actual_result` の材料にするが、**記録であって判定ではない**（アサーションの代わりにしない）。

**できていないこと**: アサート無しのテストを機械で検出する仕組み（lint 規則やスクリプト）は無く、レビューで見ている。ミューテーションテストで「テストが本当に効くか」を測ることはしていない（DEF-015 の PR #21 では、修正を外してテストが落ちることを手で確認した）。

## automation-06 CI統合・ゲート

**結論**: テストは PR・main への push・日次・週次・リリース前に自動で動き、失敗は集約ジョブ `ci-result` に反映される。**ゲートの定義はあるが、Ruleset（GitHub 側の強制）は本書の作成時点で未適用**。単独メンテナの体制では、バイパスと例外の統制に限界がある。

**自動実行（イベント）**

| ワークフロー | トリガー | 役割 |
|---|---|---|
| `ci.yml` | `pull_request`・`push`（main）・手動・他ワークフローからの再利用 | select・lint・unit-api・contract・e2e（4 project）・compose・images・docs-check → 集約 `ci-result` |
| `nightly.yml` | `schedule`（日次・週次）・手動・（定義を変えた PR） | 全件、週次は ×3。flaky 検出・選択ロジックの検証・健全性トレンド |
| `release.yml` | タグ `v*.*.*`・手動 | ci.yml + security.yml を再利用して通ってから公開 |
| `security.yml` | `pull_request`・`push`・週次・手動・再利用 | 集約 `security-result` |

**ゲートの設計**

- required checks は集約ジョブ**だけ**（`ci-result` と `security-result`）。個別のジョブ名は required にしない。`ci-result` は `needs` の 8 ジョブすべてが `success` であることを要求し、**skipped・cancelled も成功扱いにしない**（`jq -e 'all(.value.result == "success")'`）。ジョブを足しても Ruleset の変更は要らない。
- `continue-on-error` は 0 箇所（ワークフロー全体）。再試行で緑にする設定も無い（`retries: 0`）。
- 対象 SHA を明示する。pull_request では merge commit ではなく PR の head をテストして記録する（`TARGET_SHA`）。

**Ruleset の適用状況（方針と出典。時点で変わる）**

- **定義**: `.github/settings/ruleset-main.json`（`enforcement: active`）。PR 必須・squash のみ・承認 1 件 + code owner review・stale review の無効化・required checks（`ci-result`・`security-result`。`strict`）・force push 禁止・ブランチ削除禁止・linear history。タグの保護は `ruleset-release-tags.json`。
- **適用**: リポジトリの管理者が別の手順で行う（`scripts/ci/apply-settings.sh --dry-run` → 適用 → `scripts/ci/snapshot-github.sh` で実態を保存。[.github/settings/README.md](../.github/settings/README.md)）。**本書の作成時点（2026-10-11 16:03 UTC に `gh api` で確認）では、Ruleset は 0 件で、ブランチ保護も無い（404）**。適用日は未定。出典は [ADR-0004](adr/0004-single-maintainer-governance.md)（「適用は未実施」）と [ai-context.yaml](ai-context.yaml) の `repository.expected_controls`。
- **証跡**: 適用状況のスナップショット（`rulesets.json`・`branch-protection.json`・`check-runs.json`）は、`docs/evidence/github/` に**まだ無い**（そこにあるのは欠陥 Issue の写しだけ）。適用したら、スナップショットを保存し、本節と ADR-0004 の状態を更新する。
- 現状で効いている設定: squash のみ・マージ後のブランチ削除・secret scanning と push protection・Dependabot security updates。**効いていないもの**: 必須の status check、承認、force push 禁止、直接 push の禁止。

**マージの実績（Ruleset に頼らず、事後に確かめた事実）**

| 項目 | 事実 | 出典 |
|---|---|---|
| main の履歴 | 25 commit のうち、PR を経ないのは初期の取り込み 1 件だけ。残り 24 件は PR のマージ（squash） | `git log origin/main` |
| CI 導入後（#8 以降）にマージした PR | 15 件。**すべて、マージ時の head で `ci-result` が success**。`security-result` は 13 件が success（残る #8・#20 は、`security.yml` が main に入る前に作られ、その check が存在しなかった） | PR の head commit の check-runs |
| CI 導入前にマージした PR | 9 件（#1〜#4・#7・#9・#10・#12・#21）。当時は `ci.yml` が main に無く、check 自体が無かった（失敗を無視したのではない） | PR のマージ時刻（#8 は 2026-10-11 08:37 UTC） |
| CI が赤のままマージした PR | 0 件 | 同上 |

**CI の失敗 10 件の内訳**（ci.yml が完了した 55 run のうち。ゲートが意図どおり止めたものが多い）

| 原因 | 件数 | run の例 |
|---|---|---|
| prettier（整形） | 2 | 38125782992、38125823870 |
| docs-check（影響マップ 3、ID 参照・リンク 1） | 4 | 38126691020、38138793218、38139049588、38129297063 |
| flaky（共有ランナーの負荷） | 2 | 38123866985（TC-073・#25）、38140205187（TC-074・#37） |
| 選択実行で対象 0 件の project が失敗（`--pass-with-no-tests` が無かった） | 1 | 38123661869（修正済み） |
| 初回のパイプライン立ち上げ（複数ジョブ） | 1 | 38119375067 |

**バイパス・例外の扱いと限界（単独メンテナ）**

- 定義上の bypass: 管理者（Admin ロール）の `pull_request` モードに限る（PR 経由のみ。直接 push・force push・削除は bypass できない）。使うときは PR 本文に理由を書き、**CI が赤のまま bypass しない**運用ルールとする（[.github/settings/README.md](../.github/settings/README.md)、ADR-0004）。
- **実績**: Ruleset が未適用で bypass の概念が動いていないため、bypass の使用記録（Rulesets の Insights）は**そもそも存在しない**。代わりに上の表（マージ時の check の状態）で、赤のままのマージが 0 件であることを確かめた。
- 例外の登録先: CI が赤のまま入れる必要が生じた場合は、PR 本文に理由・影響・期限を書き、本節の表に行を足す（現在 0 件）。
- **限界**: ① 承認者と作成者が同じ（オーナー、またはオーナーの許可を得て代行する AI）で、独立したレビューは無い。② bypass は required checks も飛ばせるので、「赤なら bypass しない」は機械ではなく運用ルール。③ 不在時の代理が置けない。④ Ruleset が未適用の間は、これらの設計上の統制そのものが効いていない。⑤ フェーズ1の PR のマージは、オーナーの明示許可（2026-10-11）に基づく AI の代行。

## automation-07 Flaky・retry・quarantine

**結論**: **retry で隠さず**、不安定なテストは台帳（失敗率・原因・担当・期限）で管理し、期限（30 日以内）で隔離する。台帳 2 件、期限切れ 0。週次の混在検出は実績 0 回。

**台帳（ledger）・原因（cause）・隔離期限（quarantine_expiry）**: 正本は [quality/flaky-ledger.yaml](../quality/flaky-ledger.yaml)。

| テスト | 失敗率 | 原因 | 担当 | 隔離開始 | 期限 | 状態 |
|---|---|---|---|---|---|---|
| TC-073 | 0.1 | 環境差（共有ランナーの負荷 + 絶対時間のしきい値。追加 p95 452ms） | バックエンド担当 | 2026-10-11 | 2026-11-10 | 対策済み。週次の確認待ち（#25 open） |
| TC-074 | 0.1 | 環境差（共有ランナーの負荷 + 計測の粒度。追加が 1054ms） | フロントエンド担当 | 2026-10-11 | 2026-11-10 | 対策済み（#37 closed）。週次の確認待ち |

- 台帳は**空で開始**し、実際に pass と fail の混在を観測したものだけを書く。書けば許されるわけではなく、期限が切れると CI（docs-check）が失敗する（`node scripts/regression/flaky-report.mjs --validate-ledger`、2026-10-12 に PASS）。隔離中も日次では実行し続ける。
- 検出: 同一 SHA・同一テストで pass と fail が混在したら flaky（`flaky-report.mjs`）。**flaky があれば、台帳にあっても検出を fail にして隠さない**。台帳に無いものは nightly が `flaky` ラベルの Issue を自動起票する。
- 原因の分類: タイミング依存／データ共有／外部依存／環境差／本物の不具合。**本物の不具合なら**、`defect` を起票し、修正 PR に回帰ケースを足す（#15 は実際にこれだった。サーバーを直した）。

**retry で隠さない（no_hidden_retry）**: Playwright `retries: 0`、CI は `--retries=0` を明示。`ci-summary.json` の `retried_success` は全層で 0（run 38152472087）。0 でなければ設定違反として扱う。

**flaky 率の追跡と再発防止**

| 指標 | 値 |
|---|---|
| 隔離中 / 自動ケース | 2 / 75 = 2.7%（[ai-context.yaml](ai-context.yaml) の宣言の上限 1% を**超えている**。対策済みで週次の確認待ち） |
| run のうち flaky が原因の赤 | 2 / 55 run（3.6%） |
| 修正後の安定性の実証 | #15: 修正前 6 回中 2 回失敗 → 修正後 315 回で失敗 0。#37: ローカルで 400 件 pass |

再発防止: ① 絶対時間のしきい値を機能層に置かない（番兵 + perf 層。[ADR-0005](adr/0005-functional-layer-perf-sentinel.md)）。② 本物の不具合なら実装を直し、緩和しない（PR #21）。③ 週次の `--repeat-each=3` で混在の有無を確認してから台帳を外す。

**できていないこと**: 週次の混在検出は実績 0 回（最初の起動は 2026-10-11 20:00 UTC の予定）。flaky 率の週・月の推移は、運用が短くて出せない。

## automation-08 リスク・要求カバレッジ

**結論**: 高リスクと必須ケースの**すべてに自動テストが対応**している（high 3 件・必須 66 件、いずれも 100%）。対応表は `docs/data/cases.csv`（`risk_ids`・`requirement_ids`）と [docs/data/traceability.csv](data/traceability.csv)。コードのカバレッジ（行 99.69% / 100%）だけを指標にしていない。

**リスクとケース・自動テストの対応**（集計。正本は `cases.csv`。自動 = `automation_layer` が manual 以外）

| リスク | 内容 | 優先度 | ケース | うち自動 |
|---|---|---|---|---|
| RISK-001 | データ損失 | high | 12 | 12 |
| RISK-003 | 保存失敗時の画面と保存の乖離 | high | 20 | 20 |
| RISK-004 | 破損データの自動上書き | high | 4 | 4 |
| RISK-002 | 検証抜け・誤判定 | medium | 23 | 23 |
| RISK-005 | XSS・インジェクション | medium | 3 | 3 |
| RISK-006 | 並び順の誤り | medium | 6 | 6 |
| RISK-007 | モバイル・アクセシビリティ不備 | medium | 11 | 9 |
| RISK-008 | API 契約逸脱 | medium | 13 | 13 |
| RISK-011 | 停止に気づけない | medium | 6 | 6 |
| RISK-013 | 二重送信・並行操作 | medium | 8 | 8 |
| RISK-010 | 件数増加時の性能劣化 | low | 2 | 2 |
| RISK-014 | ブラウザ差異 | low | 2 | 1 |
| RISK-015 | コンテナ起動・環境差 | low | 4 | 4 |
| RISK-016 | 認証なし前提の逸脱 | low | 1 | 1 |
| RISK-009 | 依存・コンテナの脆弱性 | low | **0** | 0 |
| RISK-012 | 将来のスキーマ移行失敗 | low | **0** | 0 |

- 高リスク 3 件: ケースは 36（重複を除くと 31）で、**すべて自動**。必須ケース 66 件のうち自動 66 件（100%）。
- 要求 34 件は、すべて観点を経由してケースへたどれる（[02 の 1.3](02-test-perspectives.md)）。適用の観点 57 行はすべて 1 件以上のケースに紐づく（[03 の 1.1](03-test-spec.md)）。

**カバレッジの穴（明示）**

| 穴 | 内容 | 扱い |
|---|---|---|
| RISK-009（依存・コンテナの脆弱性） | ケース 0 | テストではなく `security.yml` の検査（SCA・コンテナ・SBOM）で見る。自動テストの対応表には載らない |
| RISK-012（将来のスキーマ移行失敗） | ケース 0 | フェーズ1に移行が無い。フェーズ2で実際に流して確かめる計画（[04 の regression-14](04-regression.md)） |
| RISK-007・RISK-014 の実機側 | TC-071・TC-072 が**未実施** | 期限 2026-10-31（regression-09・12） |
| 分岐カバレッジ | backend `src/app.js` の 48〜49 行（本文読み捨ての 10 秒タイムアウト分岐。時間に依存するため通していない）。分岐の最小は frontend `messages.js` 80% | 行のしきい値 90% は満たす。穴は PR #21 に記録 |

**コードカバレッジ**（run 38152472087。`coverage-backend.json`・`coverage-frontend.json`）

| 対象 | 行 | 分岐 | 関数 |
|---|---|---|---|
| backend（`src/`） | 99.69% | 98.09% | 98.78% |
| frontend（`src/`。`main.js` を除く） | 100% | 98.18% | 100% |

行のしきい値 90% を `backend/scripts/run-tests.js`・`frontend/package.json` が強制する（下回ると失敗）。**コードの網羅率は、対応するリスクがあるという意味ではない**ので、上の対応表と併せて見る。

## automation-09 実行時間・並列性

**結論**: PR のフィードバックは、CI の成功 45 run で**中央値 161 秒・p95 234 秒・最大 458 秒**で、宣言した上限 10 分（600 秒）の 39% に収まっている。最も遅いのは compose（140 秒）。並列は、ジョブ・Playwright・node:test の 3 段で効かせている。

**測定値**（2026-10-11 の ci.yml。`gh run list`・`scripts/regression/health-trend.mjs` の出力）

| 項目 | 値 |
|---|---|
| 成功 run の所要 | 45 run。最小 139 秒・中央値 161 秒・p95 234 秒・最大 458 秒 |
| 上限（宣言） | 10 分（`maximum_feedback_minutes: 10`。[ai-context.yaml](ai-context.yaml) が初出の宣言値） |
| 直近の全件（run 38153550607）の全体 | 170 秒。ジョブ別: compose 140・e2e webkit 67・e2e chromium 51・e2e mobile 45・e2e firefox 41・images 30・contract 22・unit-api 21・lint 20・docs-check 13・ci-result 10・select 9（秒） |
| リリースの全件（run 38152472087） | 215 秒（ci + security + 証跡検査 + 公開の準備を含む） |

**並列性と資源**

- ジョブ並列: e2e は 4 project を別ジョブで並列、compose・contract・unit-api・lint・images・docs-check も並列。全体の所要は最も遅いジョブ（compose）に近い（select 9 秒 + compose 140 秒 + ci-result 10 秒 ≒ 160〜170 秒）。
- テスト並列: node:test の既定の並列度、Playwright の `fullyParallel: true`。専用のスタックを持つため並列でも汚染しない。compose だけ直列（workers=1）で、これが最大のボトルネック。
- 資源: GitHub-hosted の `ubuntu-24.04`。Playwright のブラウザは `actions/cache` で、Docker のレイヤーは `type=gha` でキャッシュする。PR 層は変更影響で選択して実行数を減らす（[04 の regression-04](04-regression.md)。選択実行の run の例は 145 秒・152 秒）。
- 選択実行でも frontend の unit は常に全件（0.5 秒と小さいため）。

**悪化したときの対処（方針）**

1. 成功 run の p95 が 10 分を超えたら、まず最も遅いジョブ（現在は compose）を分割・並列化し、次に PR 層の選択を増やす。
2. 健全性トレンド（`health-trend.mjs`）は、p95 が 1,800 秒（30 分）を超えたら問題として出す（nightly の report）。**10 分の宣言と 30 分の検出の閾値が食い違っている**ので、宣言値に合わせる見直しが必要（できていないこと）。
3. 実行時間の推移は、現時点では**傾向と言えるほど長くない**（2026-10-11 の 45 run。前半の中央値 170.5 秒・後半 154.0 秒）。継続計測は nightly の `health-trend.json`（schedule の実績が付いてから）。

## automation-10 レポート・証跡

**結論**: すべての run が**対象 SHA・層別の結果・JUnit・失敗時のスクリーンショット／動画／トレース**を保存し、Actions の artifact として **90 日保持**する。リリースの run は証跡として Git に取り込み、sha256 で改変を検知する。

**保存するもの**

| 証跡 | 内容 | 保持 |
|---|---|---|
| 対象 SHA | `TARGET_SHA`（PR は head の SHA）をジョブの summary と `ci-summary.json` の `commit_sha` に記録 | run に紐づく |
| `ci-summary.json` | 層別の合計・成功・失敗・skipped・再試行成功・所要、TC ごとの結果、カバレッジ、ジョブの結果、ゲート判定 | artifact 90 日 |
| JUnit XML | backend（all・contract）・frontend・e2e の各 project・compose | artifact 90 日（`junit-coverage-unit-api`・`e2e-evidence-*`） |
| 失敗時の診断 | Playwright の `trace`・`screenshot`・`video` を **失敗時に保存**（`retain-on-failure` / `only-on-failure`）。HTML レポート | artifact 90 日 |
| 選択の記録 | `regression-selection.json`（選んだ TC・理由・外したリスク） | artifact 90 日 |
| 観察値 | テストごとの実際の値（画面・API 呼び出し・計測値）を `observations/<TC>.json` に | リリース run は Git に取り込む |
| リリース証跡 | run 38152472087 の `ci-summary`・JUnit・観察値・セキュリティ結果を `docs/evidence/runs/38152472087/` に取り込み、`manifest.json` が全ファイルの sha256 を持つ | Git（永続） |

- **失敗 run でも artifact が残る**ことを確認した: main push の失敗 run 38140205187 は、`e2e-evidence-chromium`（約 2.07 MB。トレース・動画を含む）・`ci-summary`・`regression-selection` など 20 件を保持し、期限は 2027-01-09（90 日）。すべての upload は `if: always()`。
- Release の run 38152472087 の artifact は 28 種（`SOURCE.json` に一覧）。
- **保持期間を決めている**: ワークフローの `retention-days: 90`。Actions の artifact は 90 日で消えるので、**長期に残す必要があるのはリリースの証跡だけ**で、これを Git に取り込む（`docs/evidence/README.md`）。リリース以外の run の細部は 90 日で失われる。
- **限界**: 観察値は成功したテストが実際に見た値の記録で、失敗の再現には失敗時のトレース・動画を使う。トレースは大きいため Git には取り込まない。

## automation-11 環境・設定・秘密情報

**結論**: テストは**秘密情報を使わず**、設定は環境変数と専用の一時領域で分離し、外部サービスに依存しない。CI の権限は最小で、action は SHA 固定。保管する秘密が無いため、**ローテーションの運用は該当しない**。

**設定の分離（config_separation）**

- backend の設定は環境変数（`PORT`・`HOST`・`DB_PATH`・`COMMIT_SHA`・`LOG_LEVEL`）で渡す純粋関数 `loadConfig`（`backend/src/config.js`）。テストは `PORT=0`（OS が空きポートを選ぶ）と専用の一時 DB を渡す。
- URL・ポートの直書きは無い（実行時に得た `backend.url`・`stack.url` を使う）。固定の絶対パスも使わない。
- 環境の版は `mise.toml`（Node 24、Python 3.12）と `package-lock.json`、action の SHA 固定、ツールの digest 固定で揃える（[ADR-0002](adr/0002-test-and-quality-toolchain.md)・[ADR-0003](adr/0003-node-lts-24-pin.md)）。

**秘密情報の保護（secret_protection）**

- テスト・fixtures・テストデータに秘密情報・個人情報は無い。テストデータは合成データのみ（`docs/data/datasets.csv`）。
- テストを実行するワークフロー（`ci.yml`・`nightly.yml`）が使う認証は自動発行の `GITHUB_TOKEN` だけで、`secrets.*` は参照しない。GHCR への push は `release.yml` の公開ジョブだけが `GITHUB_TOKEN` で行う。
- 権限は最小: ワークフロー全体は `permissions: contents: read`。昇格するのは、nightly の report（`actions: read`）、flaky の Issue 起票（`issues: write`。そのジョブだけ）、公開（`release.yml` の publish ジョブだけ）。
- 検出: gitleaks が git の履歴全体を検査する（`security.yml`）。GitHub の secret scanning と push protection は有効（[ai-context.yaml](ai-context.yaml)）。

**依存サービスの制御（dependency_control）**: 外部サービス連携は無く（`integrations: []`）、テストが通信するのは localhost の自プロセスだけ。compose は専用のプロジェクト名・ボリューム・空きポートで、外のものに触れない。ツールのコンテナは digest で固定し、action は SHA 固定を GitHub 側でも強制する設定（`sha_pinning_required`。適用済み）。

**ローテーションと権限最小化**: テストが使う長期の秘密が無いので、ローテーションの対象が無い（`GITHUB_TOKEN` は run ごとの短命の発行）。権限の最小化は上のとおり `permissions` で明示した。**秘密を導入するときは、ローテーションの周期と担当を決めてから使う**。

## automation-12 所有・保守責任

**結論**: 所有者（CODEOWNERS・ジャーニー・隔離の担当）と、失敗対応の目安（SLA）を決めてある。ただし**全ロールが単独のオーナーの兼務で、不在時の代理は置けない**。SLA は 2026-10-11 の数件で守れたが、継続の実績は無い。

**所有者（owner）**

| 対象 | 所有者 | 出典 |
|---|---|---|
| 既定（テストコード全体を含む） | プロダクトオーナー兼メンテナ（CODEOWNERS の `*`） | `.github/CODEOWNERS` |
| ジャーニー J-01・J-03・J-05 のテスト | バックエンド担当 | `quality/journeys.yaml` |
| ジャーニー J-02・J-04 のテスト | フロントエンド担当 | 同上 |
| 隔離中のテスト | TC-073 はバックエンド担当、TC-074 はフロントエンド担当 | `quality/flaky-ledger.yaml` |
| 影響マップ・ジャーニーの見直し、自動化の穴 | QA 担当、QA リード | `quality/README.md` |

**失敗対応の目安（SLA）と達成状況**

| 事象 | 一次対応 | 目安 | 実績 |
|---|---|---|---|
| main の `ci-result` が赤 | 変更を入れた人 | 当日中に着手。1 営業日で修正か revert | run 38140205187（2026-10-11 12:41 UTC）→ #37 起票（12:51）→ 修正 PR #38 マージ（12:59）。約 19 分で解消 |
| 日次の全件回帰が赤 | 該当ジャーニーの担当 | 翌営業日中に切り分け | **対象の事象が無い**（schedule の実績 0 回） |
| `flaky` Issue | テストの担当 | 3 営業日で原因を分類。直せなければ隔離（30 日） | #15: 起票から約 21 分で修正。#37: 起票から約 8 分で修正。#25: 起票後に原因を分類し、対策を #38 で入れた（約 4.5 時間）。台帳で隔離 |
| `known-gaps` の期限切れ | QA リード | 期限前にテストを足すか、理由付きで期限を更新 | 対象が無い（0 件） |
| 影響マップ・ジャーニーの見直し | QA 担当 | 四半期ごと、またはリリース前 | 初回は未実施 |

SLA の達成状況は 3 件の事象での事実で、**継続的に追う仕組み（達成率の定期集計）はまだ無い**。

**廃止判断（retirement）**: テストの廃止は `cases.csv` で扱い（`obsolete`）を決めてから、journeys・影響マップから外す（`impact-check` が古い glob を警告する）。判断の担当は QA リード。隔離したテストは、期限（30 日）までに**直すか、理由つきで期限を更新するか、削除する**（期限が切れると CI が失敗する）。廃止の実績は 0 件。

**限界と合意**: 上の所有は、単独のオーナーが全ロールを兼ねる前提の割り当てで、**オーナー本人以外の合意は取れていない**。本書のマージ（プロダクトオーナーの承認）をもって、割り当てを承認したものとして扱う。協力者が増えたら、CODEOWNERS のパス別の所有者と、一次対応の担当を分ける（[ADR-0004](adr/0004-single-maintainer-governance.md)）。

## automation-13 健全性トレンド

**結論**: 健全性の指標・閾値・検出の仕組み（`health-trend.mjs`、nightly の report）は用意した。しかし**運用が 1 日（約 9 時間）で、schedule の実績が 0 回**のため、時系列の分析・定期報告は**成立していない**。現在の成功率は閾値を下回っている。

**指標と閾値**

| 指標 | 閾値・目標 | 検出の仕組み |
|---|---|---|
| CI・nightly の成功率 | 0.9 以上 | `scripts/regression/health-trend.mjs`（直近 N run）。下回ると `problems` に出る |
| 連続失敗 | 2 回以下 | 同上 |
| 所要時間（p95） | 10 分（宣言）。検出の閾値は 1,800 秒（食い違いは automation-09） | 同上 |
| flaky 率 | 1% 以下（宣言。現在 2.7%） | `flaky-report.mjs`、台帳 |
| 未実行率 | 手動 2 件（TC-071・TC-072）= 2.6%（実施表の `not_run`） | `docs/data/executions.csv` |

**現在値**（`health-trend.mjs` を 2026-10-11 16:12 UTC に実行。直近 100 run）

| workflow | run 数 | 成功率 | 所要（中央値 / p95） | 連続失敗 | 問題 |
|---|---|---|---|---|---|
| ci.yml | 65（取り消し 8 を含む） | 0.825 | 161 秒 / 234 秒 | 0 | 成功率が下限 0.9 未満 |
| nightly.yml | 21（schedule は 0。定義を変えた PR の検証 run） | 0.85 | 188 秒 / 344 秒 | 0 | 成功率が下限 0.9 未満 |

- **閾値違反の読み方（対処）**: ci.yml の失敗 10 件の内訳は automation-06 の表のとおり。**ゲートが意図どおり止めたもの**（整形・docs-check）が 6 件、flaky が 2 件（対策済み）、選択実行の設定不備が 1 件（修正済み）、初回の立ち上げが 1 件。main への push に限ると 13 run 中 12 成功（92.3%）で、失敗の 1 件は #37。PR の反復を含む初日の値で、**劣化の傾向を示すものではない**。閾値は変えず、そのまま問題として残す。
- 実行時間の推移: 前半の中央値 170.5 秒、後半 154.0 秒（45 run）。短すぎて傾向とは言えない。
- 時系列: 期間は 2026-10-11 の約 9 時間（06:50〜16:09 UTC）。**4 週間未満**で、週次・月次の推移は出せない。
- 定期報告: 健全性レポートは nightly の artifact（`nightly-report-<tier>` の `health-trend.json`）として出る設計だが、**schedule の実績が無く、定期レポートとして出した実績は無い**。報告の様式（月次の表）と提出先は未定。
- 計画（予定）: 最初の schedule の起動（2026-10-11 18:00 UTC・20:00 UTC）後、運用 4 週間が経った時点で、成功率・flaky 率・実行時間・未実行率の推移を本章に追記する。承認はマージ時。四半期ごとの棚卸し（[04 の regression-10](04-regression.md)）に合わせて、閾値の見直しも行う。

## 変更履歴

| 版 | 日付 | 内容 | 作成 | レビュー | 承認 |
|---|---|---|---|---|---|
| 1.0 | 2026-10-12 | 初版（v1.0.0 の自動テストの設計・品質・ゲート・健全性） | QA 担当（AI エージェントが作成） | QA リード（未実施） | プロダクトオーナー（PR のマージで確定。未実施） |
