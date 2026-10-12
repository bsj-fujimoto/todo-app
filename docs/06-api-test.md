# 06 API テスト成果物

| 項目 | 内容 |
|---|---|
| 文書ID | DOC-06 |
| 版 | 1.1 |
| 更新日 | 2026-10-12 |
| 状態 | draft（オーナーの確認待ち。PR マージ＝承認の代行） |
| 対象 | todo-app 仕様書 v1.1、リリース v1.0.0（commit 5fcf40a7e58dc253e53ff56860d0669a69abda26）の backend API `/api/v1`（契約 `backend/openapi.yaml` 5 operation） |
| 作成 | QA 担当（ロール。実作業は AI エージェント） |
| レビュー | QA リード（未実施。作成者と同じロールの兼務で、第二の目は無い） |
| 承認 | プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ。オーナーの確認が済むまで draft のまま） |
| 正本 | この md、[backend/openapi.yaml](../backend/openapi.yaml)（契約）、`backend/test/api/`（テスト）、`docs/data/cases.csv`・`executions.csv`（ケースと実施）。Git が版管理 |

この文書は、backend API を画面（UI）から独立して検証する仕組みの**方針・網羅の判断・限界**を書く。ケースの行は [03 テスト仕様書](03-test-spec.md) と `docs/data/cases.csv`、実施の行は `docs/data/executions.csv` が正本で、ここには写さない。**「ある」と書いたものはテストと run で確認できるものだけ**で、無いものは「ない」、使わないものは「対象外」と理由付きで書く。

## この成果物の結論

- **契約の正本は 1 つ**: `backend/openapi.yaml`（OpenAPI 3.1.0、`info.version` 1.0.0、`/api/v1`）。operation 5 本（一覧・追加・完了切替・削除・health）、宣言したステータスは 20 組（operation × status）。契約先行で、実装との差分は CI の contract ジョブ（lint → oasdiff → 契約適合テスト）で検出する。
- **全応答を契約で検証する**: API テストの HTTP クライアントは、契約にある operation への**すべての応答**を Ajv（JSON Schema 2020-12 + ajv-formats）で `openapi.yaml` のスキーマに対して検証する（検証しない例外は api-04 に明記）。実装側にスキーマを二重定義しない。
- **v1.0.0 の run の結果**（`gh-run-38152472087`、対象 SHA 5fcf40a7…）: api 層 74 件・contract 層 8 件がすべて pass、失敗 0・skip 0・retry で救った件数 0。api 層の内訳は、ケース ID を持つテスト 38 件（27 ケースに対応）、補助検査 30 件、契約突き合わせ 6 件。
- **declared な 20 組のうち 19 組を HTTP 経由で再現して確認**した。確認できていないのは `GET /api/v1/tasks` の 503 だけ（api-04・api-06 に理由と計画）。
- **対象外は 2 観点（承認済み）**: api-02（認証・認可。認証なしの 1 人用）と api-08（ページング。一覧は全件返却）。理由・承認者・承認日・見直し日・前提が崩れたときの扱いは各章と [01 テスト計画書](01-test-plan.md) の plan-03。
- **できていないこと**（正直な一覧は本書末尾「できていないことと改善計画」）: consumer contract（Pact 等）は未導入で、利用側の期待を契約と突き合わせる自動検査が無い（api-11）。rate limit は実装していない（api-09）。同じ id への並列 PATCH・PATCH と DELETE の競合のテストが無い（api-07）。oasdiff が壊れた変更を実際に止めることの自動確認が無い（api-01・api-10）。API 結果に endpoint・検証種別のタグが機械可読な形で残っていない（api-13）。

### 13 観点の状態（一覧）

| 観点 | 状態 | 要点 | 根拠の章 |
|---|---|---|---|
| api-01 API 契約・正本 | 実施済み（検出力の自動確認が未） | 正本・版・sha256 を固定。差分は CI で毎回検出。契約違反 0 件、契約に書かれていない実装の挙動 3 件を識別 | api-01 |
| api-02 認証・認可 | **対象外（承認済み）** | 認証なしの 1 人用。「認証なしで全操作でき、401・403 が返らない」ことだけ確認（TC-059） | api-02 |
| api-03 Request検証 | 実施済み（PATCH の壊れた JSON のみ未） | 入力を取る 3 operation × 6 種の 18 マスのうち、あり 13・一部 1・対象外 4（なしは 0） | api-03 |
| api-04 Response・Status・Schema | 実施済み（Cache-Control など一部未） | status 27/27、schema 26/27、content-type 26/27（共通ヘルパ）。20 組中 19 組を再現 | api-04 |
| api-05 業務ルール・状態 | 実施済み（ST-07 は e2e のみ） | 状態遷移 11 行のうち 10 行が API 層のケースに対応。DB の行・SHA-256 まで整合を確認 | api-05 |
| api-06 異常・エラー契約 | 実施済み（GET 503 は未再現） | 5 operation × 5 種の 25 マスのうち、あり 18・一部 4・対象外 3。再試行可否の機械可読な表現は無い | api-06 |
| api-07 冪等性・同時実行 | 一部 | 12 マスのうち、あり 4・一部 2・なし 4・対象外 2。同時追加 20 件・同時削除 10 件・同値再送・再削除はある。同 id の並列 PATCH・競合・逆順到着は無い | api-07 |
| api-08 ページング | **対象外（承認済み）** | ページング無し。安定した並び順だけ API で確認（TC-038・TC-039） | api-08 |
| api-09 Timeout・Retry・Rate limit | 一部（rate limit は未実装） | 部分失敗・再試行はある。サーバー側の timeout・backoff・rate limit のテストは無く、rate limit は実装していない | api-09 |
| api-10 後方互換・Versioning | 一部 | oasdiff による破壊的変更の検出は CI で運用。互換テスト（旧 consumer の期待）・deprecated・sunset の運用実績は無い | api-10 |
| api-11 Consumer contract | **未導入** | 利用側は frontend のみ。Pact 等は無く、同等手段も一部。改善計画あり | api-11 |
| api-12 データ・後始末 | 実施済み（tenant 分離は適用外） | テストごとに専用 DB・専用ポート・固定 clock。afterEach で必ず後始末 | api-12 |
| api-13 自動化・CI・報告 | 実施済み（機械可読タグはケース ID 付き 27 件のみ・全文証拠は一部） | PR・main・日次・週次・リリースで実行。結果は JUnit と観察値 JSON に対象 SHA つきで保存 | api-13 |

## 0 対象と読み方

### 0.1 対象 endpoint（契約 5 operation）

| 記号 | operation（operationId） | メソッドとパス | 宣言したステータス | 入力 | 更新系 |
|---|---|---|---|---|---|
| E1 | listTasks | GET `/api/v1/tasks` | 200 / 500 / 503 | なし（クエリ・本文を取らない） | いいえ |
| E2 | createTask | POST `/api/v1/tasks` | 201 / 400 / 422 / 500 / 503 | JSON 本文 `{title}` | はい |
| E3 | updateTaskCompleted | PATCH `/api/v1/tasks/{id}` | 200 / 400 / 404 / 500 / 503 | path の id（UUID）+ JSON 本文 `{completed}` | はい |
| E4 | deleteTask | DELETE `/api/v1/tasks/{id}` | 204 / 400 / 404 / 500 / 503 | path の id（UUID） | はい |
| E5 | getHealth | GET `/api/v1/health` | 200 / 503 | なし | いいえ |

契約外のパス・メソッドは 404 `ROUTE_NOT_FOUND`、想定外の障害は 500 `INTERNAL_ERROR` で、どちらもエラー封筒（`{error: {code, message}}`）で返し、契約の `Error.code` の列挙に載っている。

### 0.2 マスの語彙

| 語 | 意味 |
|---|---|
| あり | そのマスを検証するテストがあり、v1.0.0 の run（`gh-run-38152472087`）で pass した |
| 一部 | 一部の入力・状態だけ検証している。足りない部分を同じマスに書く |
| なし | 検証するテストが無い（できていない。改善計画へ） |
| 対象外 | そのマスの前提が存在しない（入力が無い・認証が無い等）。理由を書く |

### 0.3 テストファイルの所在

すべて `backend/test/api/`（node:test、実 HTTP + 専用 SQLite）。TC-ID はテスト名の先頭に `[TC-xxx]` で付く（[03 の 13.3](03-test-spec.md)）。ケース ID を持たない検査は名前の先頭が `[補助]`（ケース外の補助検査）か `[契約]`（実装と契約の突き合わせ）。

| ファイル | ケース | 何を見るか |
|---|---|---|
| `create-validation.test.js` | TC-030〜TC-036 | POST の入力検証（境界・必須・型・形式・未知フィールド・壊れた JSON） |
| `update-delete.test.js` | TC-009〜TC-012、TC-015 | PATCH・DELETE の状態遷移、404・400 |
| `contract.test.js` | TC-037、TC-075、`[契約]` 6 件 | 応答スキーマ、ルート一覧・リクエスト本文・エラーコードの契約一致、検証ヘルパの自己検査、health |
| `list-order.test.js` | TC-038、TC-039 | 一覧の並び順（createdAt 降順、同時刻は保存順の新しい方が先） |
| `persistence.test.js` | TC-042 | backend を止めて同じ DB で起動し直しても保たれる |
| `storage-failure.test.js` | TC-050、TC-051 | 書込み不可（DS-008）で 503、DB 無変更、復旧後の再試行 |
| `data-corrupt.test.js` | TC-052〜TC-054 | 破損 DB（DS-007）で 500、DB 無変更、health 503 |
| `security.test.js` | TC-059、TC-060 | 認証なしで使える・直接 API の不正入力・HTML/SQL 断片 |
| `concurrency.test.js` | TC-064、TC-065 | 同時追加 20 件・同じ id への同時削除 10 件 |
| `performance.test.js` | TC-073 | 1,000 件での応答時間（番兵。本判定は perf 層） |
| `robustness.test.js` | `[補助]` 11 件 | 本文サイズ超過・Content-Type 違い・`__proto__`・契約外パス・想定外の障害 |
| `observability.test.js` | `[補助]` 5 件 | x-request-id、ログの構造、利用者データをログに出さない |
| `migrations.test.js`・`main-process.test.js` | `[補助]` 各 5 件 | DB マイグレーション、`src/main.js` の実プロセス検査 |

### 0.4 数字の出典

| 数字 | 出典 |
|---|---|
| api 層 74 件・contract 層 8 件・unit 143 件が pass | `docs/evidence/runs/38152472087/ci-summary.json`（v1.0.0 のタグ run。PR #42 が 2026-10-11T16:30:20Z に main へマージ済み） |
| api 層の内訳（TC 38・補助 30・契約 6） | 同 run の `junit/backend-junit.xml` のテスト名を数えた値（`[TC-` を含む / `[補助]` / `[契約]`） |
| ケース 27 件（`automation_layer=api`）が pass | `docs/data/cases.csv` の api 行 27 件と、`docs/data/executions.csv`（`environment` が `api /` の 27 行、`run_ref` `gh-run-38152472087`、`commit_sha` 5fcf40a…）。実施表は PR #42 のマージで v1.0.0 の run になった（旧 run の行は無い）。**main の CSV で再確認した（2026-10-12）**: api 行 27・実施表の `api /` 27 行がすべて pass |
| backend の行カバレッジ 99.69%・分岐 98.09% | 同 run の `coverage-backend.json`（全層の合算。しきい値は行 90% を `backend/scripts/run-tests.js` が強制） |
| oasdiff の結果 | 同 run の artifact `contract-report/result.json`（base 1abf247 → head 5fcf40a、`result: pass`、changelog は `No changes detected`） |

## api-01 API契約・正本

**結論**: 契約の正本は `backend/openapi.yaml` の 1 本で、版と内容の指紋を固定し、実装との差分は PR・main push・リリース・日次のたびに CI が検出する。v1.0.0 時点で、実装が契約に反する箇所は 0 件。ただし**契約に書かれていない実装の挙動が 3 件**あり（下表）、非破壊の追加として本書に記録した。

**契約の正本（API の仕様書）**

| 項目 | 値 | 出典 |
|---|---|---|
| ファイル・形式 | `backend/openapi.yaml`、OpenAPI 3.1.0 | [backend/openapi.yaml](../backend/openapi.yaml) |
| 方式 | 契約先行（PR #2 で契約を先に追加し、PR #7 で実装と契約テストを入れた（このとき契約にも修正が入っている）） | `git log -- backend/openapi.yaml` |
| 規模 | operation 5 本、スキーマ 6 本（Task・TaskList・CreateTaskRequest・UpdateTaskRequest・Health・Error）、共有応答 5 種 | 同上 |
| 変更の責任 | `/backend/openapi.yaml` はプロダクトオーナーの CODEOWNERS 対象。ただし code owner review を強制する Ruleset は**未適用**（[ai-context.yaml](ai-context.yaml) `repository.expected_controls`、[ADR-0004](adr/0004-single-maintainer-governance.md)） | `.github/CODEOWNERS` |

**対象版**

| 項目 | 値 |
|---|---|
| 契約の版 | `info.version` 1.0.0。パスの版は `/api/v1` |
| 内容の指紋 | `backend/openapi.yaml` の sha256 `97e4d99367af9b7d7ccdb08728602604fc824a751d3848ae47fa27ee7c374446`（タグ v1.0.0 の時点と現在の main で同一） |
| 対象のリリース | v1.0.0、commit 5fcf40a7e58dc253e53ff56860d0669a69abda26 |
| 版の一致 | health の `version` は `package.json` の版（1.0.0）と一致することを TC-075 が検査する。**`info.version`・`package.json`・タグの 3 者が一致することを検査するテストは無い**（現在は 3 つとも 1.0.0。api-10 の改善計画） |

**実装との差分の識別**

契約と実装の食い違いを、次の 5 つの手段で毎回検出する（すべて `contract.test.js`。`npm run contract:check -w backend` で単独実行できる）。

| 手段 | 検出するもの |
|---|---|
| ルート一覧の突き合わせ（`[契約]`） | 実装が登録したルート（メソッド + パス）が、契約の `paths` と過不足なく一致する |
| リクエスト本文の突き合わせ（`[契約]`） | POST 8 種・PATCH 6 種の本文について、契約のスキーマに合う本文は 400 にならず、合わない本文は 400 になる（Ajv の判定と実装の判定が一致する） |
| エラーコードの突き合わせ（`[契約]`） | 契約の `Error.code` の列挙 9 件と実装の `ERROR_DEFS` が一致し、利用者向け文言が契約の description と一致する |
| 全応答の契約検証（api 層すべて） | 応答の status が契約に宣言済み、content-type が契約どおり、本文が契約のスキーマに合う（`additionalProperties: false` なので余分なキーも落ちる） |
| 検証ヘルパの自己検査（`[契約]` 3 件） | 余分なキー・型違い・UUID/日時の形式違い・必須の欠落・宣言のない status・content-type 違い・本文なしのはずの本文を、ヘルパが実際に検出する |

**識別した差分（v1.0.0）**

| 区分 | 件数 | 内容 |
|---|---|---|
| 契約違反（実装が契約に反する） | 0 | v1.0.0 の run で contract 8 件 pass |
| 契約に書かれていない実装の挙動（非破壊の追加） | 3 | ① 末尾スラッシュ付きパスを同じ operation として受理する（`ignoreTrailingSlash`。`[補助]` で挙動を固定）。② 全応答に `x-request-id` ヘッダが付き、受け取った値が安全な形式なら再利用する（`observability.test.js`）。③ 本文が 1 MiB を超えると 400 `INVALID_REQUEST` で返す（契約の 400 は「本文の形式不正」の説明で、サイズ超過は明記が無い。`robustness.test.js`）。いずれも契約へ書くかどうかは未決（書くのは非破壊の追加） |
| 契約に宣言があり HTTP 経由で再現していないもの | 1 | `GET /api/v1/tasks` の 503（api-04） |
| 契約にない応答ヘッダの不在 | 1 | `Cache-Control: no-store` を付けていない（ACT-005、期限 2026-12-31。ヘッダの追加なので契約の破壊的変更ではない） |

**CI での継続検出と破壊的変更の管理**

| 項目 | 内容 | 出典 |
|---|---|---|
| 契約の lint | `redocly lint`（recommended。外したルール 3 件は理由つき: 認証なしのため `security-defined`、localhost のため `no-server-example.com`、入力のない GET のため `operation-4xx-response`） | [scripts/ci/redocly.yaml](../scripts/ci/redocly.yaml) |
| 破壊的変更の検出 | base ブランチの `openapi.yaml` と oasdiff（v1.33.0、Docker イメージを digest で固定）で比べ、レベル ERR があれば失敗。比較元は PR の base SHA、push の直前 SHA、無ければ origin/main。結果は `contract-report/result.json`（base・head の SHA・結果・理由）に残る | [scripts/ci/oasdiff-breaking.sh](../scripts/ci/oasdiff-breaking.sh) |
| 契約適合の検査 | `contract.test.js` を単独で実行（JUnit は `contract.xml`） | [.github/workflows/ci.yml](../.github/workflows/ci.yml) の `contract` ジョブ |
| いつ動くか | PR・main への push・リリース（タグ）・手動。`contract` ジョブは PR でも選択せず**常に全件**。日次・週次の nightly は unit/api の全件（契約適合テストを含む）を回すが、oasdiff は含まない | `ci.yml`、`nightly.yml` |
| ゲート | 集約ジョブ `ci-result` が `contract` を含む全ジョブの success を要求する。ただし required check としての強制は Ruleset 未適用のため **GitHub 側では強制されていない**（運用ルール「CI が赤のままマージしない」に頼る） | `ci.yml`、[ai-context.yaml](ai-context.yaml) |
| 互換性の方針 | `/api/v1` 配下は後方互換を保つ。フィールド追加は非破壊、削除・型変更・必須化は破壊的変更として v2 を切る | `openapi.yaml` の `info.description` |

**検出力の確認（2026-10-12、ローカルで 1 回）**: v1.0.0 の run が比較した範囲では契約に変更が無く（`No changes detected`）、oasdiff が**実際に壊れた変更を止める**場面は CI の実績に無い。そこで固定した同じイメージで、`openapi.yaml` を使い捨てに改変して確かめた。

| 改変（使い捨て。リポジトリには入れていない） | oasdiff の結果 |
|---|---|
| `Task.title` を必須から外す + `UpdateTaskRequest` に必須の `note` を足す | 4 件の error（`response-property-became-optional` 3 件、`new-required-request-property` 1 件）。終了コード 1（`--fail-on ERR` で CI が失敗する） |
| `Task` に任意の `note` を足すだけ | 破壊的変更なし。終了コード 0 |

限界: この確認は**手動の 1 回**で、CI のテストには組み込まれていない（oasdiff のイメージを更新したときに検出力が落ちても気づけない）。自動化は「できていないことと改善計画」の項番 2。契約と実装のずれ（status を 400 から 422 へ変えたなど、契約の文面を変えない実装側の変更）は oasdiff には出ず、全応答の契約検証（宣言済み status のみ許す）が検出する。

## api-02 認証・認可

**結論**: **対象外**（認証なしの 1 人用アプリで、認証が要る endpoint が無い）。未認証・権限別・他テナント・トークン期限の 4 種は、いずれも検証する対象が存在しない。代わりに「認証なしで全操作でき、401・403・`WWW-Authenticate`・`Set-Cookie` が返らない」ことと、「画面を迂回した不正入力を backend が断る」ことを確認している（TC-059）。

**対象外とする項目（out_of_scope）**: 認証・認可の API 試験（401・403、権限別、他テナント、トークン期限）。

| 項目 | 内容 |
|---|---|
| 理由 | 仕様 §01 が「ログイン不要・認証認可は対象外・1 インスタンス = 1 人用」と定める（REQ-015、観点 VIEW-023・VIEW-024・VIEW-026・VIEW-046 は非適用）。`openapi.yaml` に security scheme・401・403 が無く、redocly の `security-defined` を理由つきで外している。テナントの概念が無い（DB は 1 ファイルで 1 利用者）。RISK-016 は受容 |
| 承認者 | プロダクトオーナー（PR #40・#41 のマージをもって承認。フェーズ1は AI が代行マージ）。[ai-context.yaml](ai-context.yaml) の EXC-001 と [01 テスト計画書](01-test-plan.md) の plan-03 に同じ内容がある |
| 承認日 | 2026-10-12（JST。PR #40・#41 のマージは 2026-10-11 15:56〜15:58 UTC） |
| 見直し日 | 2027-01-12（plan-03）。承認の有効期限は 2027-04-12（EXC-001 の `expires_at`）。**早い方で見直す** |
| 前提が崩れたときの扱い | ネットワークへ公開する・複数人で使うと決めた時点で、公開の前に対象外を取り消す。観点（未認証・権限別・他テナント・トークン期限）を適用に戻し、認証が要る全 endpoint で 4 種のケースを足し、DAST（ZAP）を認証付きにする。**公開した環境で第三者が全タスクを閲覧・変更できる状態を残さない** |

**対象外の代わりに確認していること**

| 確認 | テスト | 結果（v1.0.0 の run） |
|---|---|---|
| 認証なしで 4 操作（一覧・追加・完了切替・削除）が成功し、全応答に `WWW-Authenticate`・`Set-Cookie` が無く、完了ログに 401・403 が 0 件 | TC-059（`security.test.js`） | pass |
| 画面を経由しない不正入力（101 文字）を backend が 422 で断り、行が増えない | TC-059 | pass |
| HTML・SQL の断片（`<script>`・`'); DROP TABLE tasks;--` など 6 種）が変換・実行されずそのまま保存・返却され、テーブルが残る | TC-060 | pass |

注意: これは「認証を要求しない」ことの確認であり、認証・認可の検証ではない。認証を入れるときの 4 種の網羅表は、そのときに追加する。

## api-03 Request検証

**結論**: 入力を取る 3 operation（E2 追加・E3 完了切替・E4 削除）× 6 種（必須・型・形式・境界・未知フィールド・不正 payload）の 18 マスのうち、**あり 13・一部 1・対象外 4**。**なし（テストが無い）のマスは 0** だが、一部の 1 マス（E3 の不正 payload）は壊れた JSON 構文のテストが無い。GET の 2 operation（E1・E5）は入力を取らないため対象外。

| 種別 | E2 POST /tasks | E3 PATCH /tasks/{id} | E4 DELETE /tasks/{id} |
|---|---|---|---|
| 必須 | あり: 本文なし・`{}` は 400（TC-035、`create-validation`） | あり: `{}` は 400（TC-010、`update-delete`。契約の突き合わせでも `{}` を確認） | 対象外: 本文を取らない。id は path で必須（ルートに載るため欠落しない） |
| 型 | あり: `title` が null・数値・配列は 400 で、422 や 500 にならない（TC-035） | あり: `completed` が文字列 `"yes"` は 400（TC-010） | 対象外: path の値は常に文字列。型違いは形式（UUID）の検証に含まれる |
| 形式 | あり: 空白のみ・タブ・改行だけは 422 `TITLE_REQUIRED`（TC-032）、改行を含むと 422 `TITLE_MULTILINE`（TC-033）、前後の空白は除去して保存（TC-034） | あり: id が UUID でなければ 404 ではなく 400 `INVALID_REQUEST`（TC-012: `abc`） | あり: 同上（TC-012: `123`） |
| 境界 | あり: 100 文字（`a`×100・😀×100）は 201（TC-030）、101 文字・😀×101・10 万文字は 422 `TITLE_TOO_LONG`（TC-031）、1 万文字は 422 で返せる（`[補助]` `robustness`）、本文 1 MiB 超は 400 で応答を確実に受け取れる（`[補助]` 4 通り）| あり: id 200 文字は 400（TC-012）。`completed` は真偽値で数値の境界が無い | あり: id 200 文字は 400（TC-012） |
| 未知フィールド | あり: `{title, extra}` は無視せず 400（TC-036）。契約の突き合わせでも確認（`[契約]` リクエスト本文） | あり: `{completed, title}`・`{createdAt}`・`{id}` は 400 で何も変わらない（TC-010） | 対象外: 本文を取らない |
| 不正 payload | あり: 壊れた JSON `{"title":`（TC-036）、JSON の `null`・文字列・数値・`{}{}`・空・`__proto__` を含むオブジェクト・Content-Type が `text/plain` や `application/x-www-form-urlencoded`（`[補助]` `robustness`）はすべて 400 | **一部**: Content-Type が `text/plain` の本文は 400（`[補助]` `robustness`）。**壊れた JSON 構文（`{"completed":`）の PATCH を直接送るテストは無い**（Fastify の共通パーサ経由で POST と同じ経路だが、検証はしていない） | 対象外: 本文を取らない |

- **契約スキーマとの一致**: リクエスト本文の判定が契約（`CreateTaskRequest`・`UpdateTaskRequest`）と一致することを、POST 8 種・PATCH 6 種で突き合わせる（`[契約]` リクエスト本文）。契約と実装がずれたらここで落ちる。
- **検証順**: 複数の違反が重なったときは「必須 → 長さ → 改行」で 1 つだけ返す（ADR-0006）。API 層には複数違反の入力を送るケースは無く、unit の TC-029（backend の `validateTitle`）で固定している。API 経路は同じ検証関数を呼ぶ。
- **E1・E5 の対象外**: クエリも本文も取らず、検証する入力が無い（redocly の `operation-4xx-response` を外した理由と同じ）。未知のクエリを付けた GET の挙動は契約にも無く、テストもしていない。

## api-04 Response・Status・Schema

**結論**: 契約に宣言した 20 組（operation × status）のうち 19 組を HTTP 経由で再現して検証している。応答は、ケース ID を持つ API テスト 27 件のうち **status を 27 件、契約スキーマを 26 件、content-type を 26 件**で検証している。header の個別検証は少ない（3 件）。

**検証の仕組み**: `backend/test/helpers/harness.js` の HTTP クライアントは、既定で全応答を `backend/test/helpers/contract.js` の `assertContract` に通す。`assertContract` は、(1) status が契約に宣言されているか、(2) 本文なしのはず（204）で本文が無いか、(3) content-type が契約の media type か、(4) 本文が契約のスキーマ（`$ref` を辿った `components.schemas`）に合うか、を検査する。スキーマは `openapi.yaml` を直接読み、実装側に二重定義しない。ヘルパ自体が壊れていないことは自己検査 3 件（`[契約]`）で見ている。

**operation × status の網羅（宣言 20 組）**

| operation | status | 確認したテスト | 状態 |
|---|---|---|---|
| E1 一覧 | 200 | TC-037、TC-038、TC-039、TC-042、TC-073 ほか多数 | あり |
| E1 一覧 | 500（`DATA_CORRUPT`） | TC-052、TC-053（`data-corrupt`。行検証 11 種を含む） | あり |
| E1 一覧 | 503（`STORAGE_FAILURE`） | **なし**。読み取りは書込み不可でも成功し（`[補助]` `storage-failure`）、503 を HTTP で起こす手段が無い。SQLite 例外の分類（BUSY・IOERR・CANTOPEN → 503）は unit の `[補助]` で確認しているのみ | なし |
| E2 追加 | 201 | TC-030、TC-034、TC-037、TC-060、TC-064 ほか | あり |
| E2 追加 | 400 | TC-035、TC-036、`[補助]` `robustness` | あり |
| E2 追加 | 422 | TC-031、TC-032、TC-033 | あり |
| E2 追加 | 500 | TC-053 | あり |
| E2 追加 | 503 | TC-050 | あり |
| E3 完了切替 | 200 | TC-009 | あり |
| E3 完了切替 | 400 | TC-010、TC-012 | あり |
| E3 完了切替 | 404 | TC-011 | あり |
| E3 完了切替 | 500 | TC-053 | あり |
| E3 完了切替 | 503 | TC-051 | あり |
| E4 削除 | 204 | TC-015、TC-065 | あり |
| E4 削除 | 400 | TC-012 | あり |
| E4 削除 | 404 | TC-011、TC-015、TC-065 | あり |
| E4 削除 | 500 | TC-053（存在しない id の削除も 404 ではなく 500 になる） | あり |
| E4 削除 | 503 | TC-051 | あり |
| E5 health | 200 | TC-075（実プロセス） | あり |
| E5 health | 503 | TC-054（破損 DB。`status: degraded`・`db: error`） | あり |

契約にない応答の確認: 契約外パス・メソッドの 404 `ROUTE_NOT_FOUND` と、ストアが分類できない例外を投げたときの 500 `INTERNAL_ERROR` は `[補助]` `robustness` で確認している。この 2 つは契約の operation に属さないため、スキーマ検証は `assertContract` ではなく、封筒のキー・コード・文言の完全一致で行う。

**検査の種類ごとの適用（ケース ID を持つ API テスト 27 件）**

| 検査 | 件数 | 備考 |
|---|---|---|
| status のアサート | 27 / 27 | すべてのケースが status を明示的に検証する |
| 契約スキーマでの本文検証 | 26 / 27 | 例外は TC-073 のみ（`contract: false`。1,000 件を 30 回呼ぶ性能計測で検証コストを入れないため。同じ応答の形は TC-037 など他のケースで検証している）。補助の末尾スラッシュ検査も `contract: false` |
| content-type の検証 | 26 / 27 | `assertContract` が全応答で media type を照合する。TC-037・TC-060 は `application/json` を明示的にもアサートする |
| content-type 以外の header のアサート | 3 / 27 | TC-030・TC-037 は `Location` が付かないこと、TC-059 は `WWW-Authenticate`・`Set-Cookie` が付かないこと。`x-request-id` は `[補助]` `observability` が検証する |

契約検証を通さない応答（`[補助]` を含む全体）: TC-073、末尾スラッシュの補助検査（いずれも `contract: false`）、生の HTTP 交換（本文サイズ超過。`fetch` が隠す早期応答と書込みの競合を見るため）、`app.inject` による想定外の障害の検査。後 2 者は封筒のキー・コード・文言の完全一致で代替している。

**未検証・できていないこと**: ① `Cache-Control` は付けておらず契約にも無い（ZAP 10049-3 の info。ACT-005）。② `x-request-id` は契約に未記載（api-01 の差分）。③ E1 の 503（上表）。④ GET の応答の並び（降順）以外の「本文の項目順」は仕様に無く検証しない。

## api-05 業務ルール・状態

**結論**: タスクの状態遷移（[03 の 8.2](03-test-spec.md) の ST-01〜ST-11、許可・禁止の両方）11 行のうち **10 行が API 層のケースに対応**する。ST-07（完了済みの削除）は API 層に直接のケースが無く、画面側の TC-014 のみ。データ整合は、応答だけでなく DB の行（`readRows`）とファイルの SHA-256 まで確認する。

| 遷移 | 内容 | 許可/禁止 | API 層のケース | 状態 |
|---|---|---|---|---|
| ST-01 | 未存在 → 追加 → 未完了 | 許可 | TC-030（100 文字で追加）、TC-034、TC-037（id UUID v4・createdAt UTC・DB 行と一致） | あり |
| ST-02 | 未完了 → 完了 | 許可 | TC-009 | あり |
| ST-03 | 完了 → 未完了 | 許可 | TC-009 | あり |
| ST-04 | 完了へ同値の PATCH（変化なし） | 許可（冪等） | TC-009 | あり |
| ST-05 | 未完了へ同値の PATCH（変化なし） | 許可（冪等） | TC-009 | あり |
| ST-06 | 未完了 → 削除 | 許可 | TC-015（204・本文なし・対象だけ消える） | あり |
| ST-07 | 完了 → 削除 | 許可 | API 層のケースは**なし**（画面側の TC-014 が DELETE 204 を 3 回観察する） | 一部（e2e のみ） |
| ST-08 | 削除済み → 完了切替・削除 | 禁止 | TC-011（404 `TASK_NOT_FOUND`。復活しない） | あり |
| ST-09 | 未存在（有効な形式の未登録 id）→ 操作 | 禁止 | TC-011 | あり |
| ST-10 | id・title・createdAt を含む PATCH 本文 | 禁止 | TC-010（400。DB 行が操作前と同一） | あり |
| ST-11 | id の形式が不正 | 禁止 | TC-012（400） | あり |

**データ整合性の確認（API を介した状態と保存の一致）**

| 確認 | テスト |
|---|---|
| 操作ごとに DB の行（id・title・completed・created_at）を直接読み、応答と一致し、他の行が変わらない | TC-009、TC-010、TC-011、TC-012、TC-015、TC-037 |
| 失敗した操作が保存データに途中まで書き込まれない（DB ファイルの SHA-256 が前後で同一） | TC-050、TC-051、TC-052〜TC-054 |
| backend を止めて同じ DB ファイルで起動し直しても、データ・並びが完全に一致し、起動は 10 秒以内でエラーログなし | TC-042（実プロセス） |
| 並びが createdAt 降順で、同時刻は保存順の新しいものが先。繰り返しても再起動しても同じ（安定順序） | TC-038、TC-039（`list-order`）、TC-064、TC-073 |
| 完了切替で並びが変わらない | TC-009、`[補助]` `list-order` |
| 破損した行（title 空・101 文字・改行・前後空白・createdAt 不正・completed 不正・id 不正の 11 種）を検知して読み書きを止め、ファイルを書き換えない | TC-052、TC-053（`data-corrupt`） |

## api-06 異常・エラー契約

**結論**: エラーは常に封筒 `{error: {code, message}}` で返し、コードは契約の列挙 9 件、文言は仕様どおりの日本語。5 operation × 5 種（4xx・5xx・エラーコード・再試行可否・情報漏えい）の 25 マスのうち、**あり 18・一部 4・対象外 3（なしは 0）**。一部の 4 マスのうち、E1 の 5xx は 503 を HTTP で再現できていないため。再試行の可否は、ステータス・コード・文言で表し、機械可読なフィールド（`Retry-After`・`retryable`）は持たない（設計判断。下に記す）。

**エラー契約（実装と契約の対応）**

| 状況 | status | code | 利用者向け文言 | 再試行 |
|---|---|---|---|---|
| 本文・id の形式不正、未知フィールド、本文 1 MiB 超 | 400 | `INVALID_REQUEST` | リクエストの形式が正しくありません | 不可（入力を直す） |
| タイトル必須・長さ・改行の違反（検証順 必須 → 長さ → 改行） | 422 | `TITLE_REQUIRED` / `TITLE_TOO_LONG` / `TITLE_MULTILINE` | 仕様書 §04 の文言 | 不可（入力を直す） |
| 有効な形式で未登録・削除済みの id | 404 | `TASK_NOT_FOUND` | タスクが見つかりません | 不可（結果は変わらない） |
| 契約にないパス・メソッド | 404 | `ROUTE_NOT_FOUND` | 指定されたパスは存在しません | 不可 |
| 保存失敗（書込み不可・容量不足・ロック・I/O 障害） | 503 | `STORAGE_FAILURE` | 保存できませんでした。もう一度お試しください | **可**（原因が解消すれば同じ操作が成功し、重複しない） |
| 保存データの破損 | 500 | `DATA_CORRUPT` | 保存データを読み込めませんでした | 不可（読み書きを止め、自動では直さない。ファイルの復元が要る） |
| 想定外の障害 | 500 | `INTERNAL_ERROR` | サーバーでエラーが発生しました | 不明（原因調査が要る。error ログに errorCode が出る） |
| health でデータストアに接続できない | 503 | （Error 封筒ではなく Health: `degraded` / `db: error`） | なし | 復旧後は 200 |

**operation × 種別の網羅**（ケース ID を持たない `[補助]` も含めて数えた）

| 種別 | E1 GET /tasks | E2 POST /tasks | E3 PATCH /tasks/{id} | E4 DELETE /tasks/{id} | E5 GET /health |
|---|---|---|---|---|---|
| 4xx | 対象外（入力なし） | あり: 400（TC-035・TC-036）、422（TC-031〜TC-033） | あり: 400（TC-010・TC-012）、404（TC-011） | あり: 400（TC-012）、404（TC-011・TC-015・TC-065） | 対象外（入力なし） |
| 5xx | **一部**: 500 は TC-052。**503 は HTTP で未再現**（api-04） | あり: 500（TC-053）、503（TC-050） | あり: 500（TC-053）、503（TC-051） | あり: 500（TC-053）、503（TC-051） | あり: 503（TC-054） |
| エラーコード | あり: `DATA_CORRUPT`（`assertSpecError` が code と文言を完全一致で検査） | あり: `INVALID_REQUEST`・`TITLE_*`・`STORAGE_FAILURE`・`DATA_CORRUPT` | あり: `INVALID_REQUEST`・`TASK_NOT_FOUND`・`STORAGE_FAILURE`・`DATA_CORRUPT` | あり: 同左 | 対象外（Error 封筒でなく Health 本文。4 キーの完全一致を TC-054 が検査） |
| 再試行可否 | **一部**: 破損は再起動を繰り返しても 500 のまま・正常な DB に替えれば復旧（TC-054） | あり: 503 → 権限を戻すと同じ POST が 1 回だけ成功し重複しない（TC-050） | **一部**: 503 は TC-051。復旧後に再起動なしで完了切替できる（`[補助]` `storage-failure`）。同じ操作の再送までは TC-051 に無い | **一部**: 503 は TC-051。復旧後の再送は未確認 | あり: 破損 DB で 503、正常な DB に替えれば 200（TC-054） |
| 情報漏えい | あり: 封筒のキーが `error` → `code`・`message` だけ（余分なキー・スタックトレース・SQL・パスが無い）。未分類の例外 `boom` の文言が出ない（`[補助]` `robustness`）。利用者データがログに出ない（`[補助]` `observability`） | あり: 同左 | あり: 同左 | あり: 同左 | あり: Health の 4 キーだけ（`version`・`commit` は意図して公開するビルド情報） |

- **漏えいの確認の根拠**: `assertError` が封筒のキーを完全一致（`["error"]` と `["code", "message"]`）で検査し、文言は固定の定数と一致させる。想定外の例外（`new Error("boom")`）でも本文は固定文言の封筒と完全一致し、例外メッセージは出ない。ログには利用者データ（タイトル）を出さない（`[補助]`）。
- **機械可読な再試行の表現が無いこと（設計判断）**: `Retry-After` やエラー本文の再試行フラグは契約に無い。consumer は frontend だけで、画面が「もう一度お試しください」を表示して利用者が同じ操作を再実行する設計のため。consumer が増えるか自動クライアントが再試行する場合は、契約へ追加する（非破壊の追加）。
- **E1 の 503 が未再現**: 契約は一覧の 503 を宣言し、実装も SQLite の BUSY・IOERR・CANTOPEN を 503 に分類するため、起こりうる。HTTP で再現する手段（読み取り時に失敗するストアの差し替え、または DB ファイルを読めない権限にする）は未検証で、改善計画の項番 4。

## api-07 冪等性・同時実行

**結論**: 更新系 3 operation × 4 種（重複送信・競合・並列更新・順序逆転）の 12 マスのうち、**あり 4・一部 2・なし 4・対象外 2**。同時追加 20 件（TC-064）・同じ id への同時削除 10 件（TC-065）・同値の再送（TC-009）・再削除（TC-015）は確認している。**同じ id への並列 PATCH、PATCH と DELETE の競合、PATCH の逆順到着は未検証**。

| 種別 | E2 POST /tasks | E3 PATCH /tasks/{id} | E4 DELETE /tasks/{id} |
|---|---|---|---|
| 重複送信 | **一部**: 同じタイトルの 2 連続 POST は 2 件作る仕様（AC-03、REQ-032）で、冪等キーは持たない。**この API 直接のケースは無く**、画面側の TC-020 のみ。失敗した追加の再送で重複しないことは TC-050 | あり: 同値の PATCH を再送しても 200・状態不変（TC-009、ST-04・ST-05） | あり: 再削除は 404（TC-015）。冪等ではなく「無い」を返す仕様 |
| 競合 | 対象外: 他の資源と競合する一意制約が無い（id は UUID で backend が採番） | **なし**: 完了切替と削除が同時に届く場合の検証が無い | **なし**: 同上 |
| 並列更新 | あり: 同時追加 20 件が全件 201・id が 20 種・欠落重複なし・保存順どおり（TC-064。同時刻が混ざる clock で検証） | **なし**: 同じ id への並列 PATCH のテストが無い | あり: 同じ id への同時削除 10 件で 204 が 1 件・404 が 9 件・500 なし（TC-065） |
| 順序逆転 | 対象外: 作成順は createdAt と保存順で決まり、到着順に依存しない（TC-064 の同時刻混在が代替） | **なし**: `completed=true` → `false` の逆順到着（最後に届いた値が勝つ）は未検証。一方、削除後に遅れて届いた PATCH が復活させず 404 になることは TC-011（逐次） | **一部**: 削除済みに後続の操作が来ても 404 で復活しない（TC-011。逐次の確認で、同時の逆順ではない） |

- **競合解決は仕様外**: 複数タブ・複数端末の同時編集の競合解決は対象外（REQ-016、[01 テスト計画書](01-test-plan.md) plan-03）。古い画面から削除済みのタスクを操作した画面側の扱いは TC-066（e2e）。
- **未検証でも残余リスクが小さい理由と、その限界**: backend は Node の単一スレッドで、`node:sqlite` の同期 API（`DatabaseSync`）により 1 要求ずつ処理する（[perf/analysis.md](../perf/analysis.md) の H2）。同一プロセス内で要求が途中で割り込むことは無く、backend は 1 インスタンス前提（SQLite の単一ファイル）。ただし「そうなっているはず」を理由にテストを省いたのであって、検証はしていない。インスタンスを増やす・DB を替える変更があるときは前提が崩れる。
- **画面側の抑止**: 同じ行の通信中の操作は無視し、追加ボタンは送信中に無効化する（frontend の unit・e2e の TC-063）。API 側の保護ではない。

## api-08 ページング・検索・並び替え

**結論**: **対象外**（一覧 API は全件を返し、ページング・検索・絞り込みが存在しない）。ただし**並び替え**は存在し、安定順序は検証している。

**対象外とする項目（out_of_scope）**: 一覧のページング（件数指定・次ページ・カーソル）と、検索・絞り込み。

| 項目 | 内容 |
|---|---|
| 理由 | `GET /api/v1/tasks` は全件を返し、`limit`・`offset`・カーソルが契約に無い。仕様に件数上限・ページング・検索の記述が無く、検索・絞り込みは仕様の対象外（REQ-015）。想定件数は千件規模（約 500 日後に 10,000 件、[perf/analysis.md](../perf/analysis.md) §3）で、10,000 件でも SLO 内（capacity 試験の実測）。件数上限は未決（UNK-002、回答期限 2026-10-16） |
| 承認者 | プロダクトオーナー（PR #40・#41 のマージをもって承認。フェーズ1は AI が代行マージ）。EXC-002 と plan-03 |
| 承認日 | 2026-10-12（JST） |
| 見直し日 | 2026-10-16（UNK-002 の回答期限）。件数が 5,000 を超えたら即時（perf/analysis.md のスケール条件）。承認の有効期限は 2027-04-12 |
| 前提が崩れたときの扱い | 件数上限またはページングを決めたら、API 契約を変更する（破壊的変更になりうる。v2 の判断）。そのとき境界（0 件・1 件・ちょうどページ境界・最終ページ）・重複・欠落・安定順序のケースと負荷試験を足す。改善案 C（Issue #31 に記載） |

**ページング以外で確認していること（並び替え）**: 一覧は createdAt の降順で、同時刻は保存順の新しいものが先（仕様）。TC-038（挿入順ではなく createdAt 順、新規追加は先頭）、TC-039（同時刻 3 件が繰り返しても再起動しても同じ順）、TC-064（同時追加で同時刻が混ざっても保存順どおり）、TC-073（1,000 件で先頭が最新、追加後 1,010 件）、`[補助]` `list-order`（完了切替で並びが変わらない）。件数が増えたときの応答の大きさ・時間は perf 層（10,000 件で転送量 305 KB）。

## api-09 Timeout・Retry・Rate limit

**結論**: **rate limit は実装していない**（backend にも nginx にも無く、契約にも 429・`Retry-After` が無い）。timeout と backoff も、アプリとして独自に実装した部分は無い。部分失敗（保存の途中で失敗しても何も反映されない）と、利用者による再試行（同じ操作を再実行すると 1 回だけ成功する）は API 層で確認している。**これは対象外の承認ではなく、設計判断として未実装を受容している**。

**現状の実装と検証（3 種 + 部分失敗）**

| 種別 | 実装の実態 | 検証 | 状態 |
|---|---|---|---|
| Timeout（サーバー側） | nginx の `proxy_connect_timeout 3s`・`proxy_read_timeout 30s`（超過は 504）。backend の SQLite の待ち時間 `BUSY_TIMEOUT_MS` 2 秒（超過すると 503 `STORAGE_FAILURE` に分類）。巨大な本文の読み捨ては最大 10 秒（`DRAIN_TIMEOUT_MS`）。backend の HTTP 層に独自の要求 timeout は無い（Node の既定） | nginx の 504 は、backend 停止時に POST が 504 になり画面が保存失敗の文言を出すことを TC-077（compose）が確認。過負荷時の 504 は perf 層（[perf/analysis.md](../perf/analysis.md)）が観測。**BUSY の 2 秒待ちを HTTP 経由で再現するテストは無い**（unit の分類のみ）。読み捨ての時間上限は `[補助]` `robustness`（Content-Length が 64 MiB 超なら待たず 400 で閉じる）が確認 | 一部 |
| Retry（クライアント側） | frontend の `api-client` は timeout も自動再試行も持たない（`fetch` 直呼び）。利用者が同じ操作を再実行する | 503 の後、同じ POST が重複せず 1 回だけ成功（TC-050）。画面側の再試行は TC-048・TC-049・TC-077（e2e） | あり（自動再試行は無いので、検証対象は「手動再試行で重複しない」こと） |
| Backoff | 無い（自動再試行が無いので不要）。`Retry-After` も返さない | — | 対象外（自動再試行が無い。入れるときに必要） |
| Rate limit | **無い**（backend・nginx・契約のいずれにも無い。`rate_limit_documented` に当たる記述も無い） | — | **なし（未実装）** |
| 部分失敗 | 書込みは 1 操作ごとに接続を開き、失敗したら反映しない。マイグレーションはトランザクションで、途中で失敗したら巻き戻る | TC-050・TC-051（DB の SHA-256 が失敗前と同一）、TC-053・TC-054（破損 DB を書き換えない）、`[補助]` `migrations`（途中失敗の巻き戻り） | あり |

**設計判断（rate limit を実装しない理由）**

| 項目 | 内容 |
|---|---|
| 判断 | 現時点では実装しない。nginx の `limit_req` など速く失敗させる仕組みは改善案 D として検討済みで見送り（[perf/analysis.md](../perf/analysis.md) の改善案） |
| 理由 | 1 人用（想定ピーク 0.5 req/s、1 日 100 操作程度）で、ネットワークへ公開しない（compose の backend ポートはホストへ公開せず、frontend の 8080 のみ）。backend の容量の限界は 1,000 件で約 100〜150 req/s、10,000 件で約 30 req/s（perf 層の実測）で、想定ピークに対し 1,000 件で 100 倍以上の余裕がある。制限を入れても**容量は増えない**（過負荷時に 504 を 30 秒待たせないだけ）。契約に 429 を足すと consumer の扱いも増える |
| 受容しているリスク | 自動クライアントや再試行の暴走で backend が飽和し（約 150 req/s 以上）、health まで 2〜4.7 秒に遅れ、nginx が 504 を返す。1 人用・非公開なので影響は限定的。飽和そのものは Issue #31（minor、open）で追跡している |
| 承認者・承認日 | プロダクトオーナー（PR #46 のマージをもって承認。フェーズ1は AI が代行マージ。**オーナーの確認は未実施**）。2026-10-12 |
| 見直し日 | 2027-01-12（api-02 の見直しと同時）。次のいずれかが起きたら即時: ネットワークへ公開する・複数人で使う・自動クライアントを追加する、perf/analysis.md §3 のスケール条件（backend の CPU p95 が 70% を 5 分以上、health p95 > 200ms、一覧 p95 > 300ms、件数 > 5,000） |
| 見直したときにすること | 制限の方式（nginx `limit_req` か backend か）を決め、契約に 429 と `Retry-After` を足し（非破壊の追加）、超過・待ち時間・回復のテストと、frontend の 429 の扱い（再試行の間隔）を足す |

**クライアント側の期待動作**: frontend は 429・`Retry-After` を扱わない（扱う必要が無い）。通信失敗（status 0）・JSON でない応答（nginx の 502・504 など）・503 はいずれも保存失敗の文言にまとめ、入力値と一覧は保つ。`api-client.test.js` が JSON でない応答（UNKNOWN）・通信失敗（NETWORK_ERROR）の分類を、TC-045〜TC-049 が画面の扱いを確認する。

## api-10 後方互換・Versioning

**結論**: 破壊的変更の検出（oasdiff）は CI で運用し、検出力は api-01 のとおり手動で 1 回確認した。一方、**deprecated・sunset の運用実績は無く**（deprecated の operation が 0 件）、旧 consumer の期待を新しい backend に当てる互換テストも無い。v1.0.0 が最初の版で、互換性を保った変更の実績はまだ無い。

| 項目 | 現状 | 状態 |
|---|---|---|
| 版管理の方針 | パスに版（`/api/v1`）。`/api/v1` 配下は後方互換を保ち、フィールド追加は非破壊、削除・型変更・必須化は破壊的変更として v2 を切る（`openapi.yaml` の `info.description`） | あり |
| 破壊的変更の検出 | PR・main・リリースで oasdiff が base と比較し、ERR で失敗（api-01）。検出力は手動で確認済み（4 件検出・追加のみは通過） | あり（自動の検出力確認は無い） |
| 実装側の変更の検出 | 契約の文面を変えずに実装の status・エラーコード・スキーマが変わると、全応答の契約検証と `[契約]` の突き合わせが落ちる | あり |
| deprecated | deprecated な operation・項目は 0 件。`Deprecation`・`Sunset` ヘッダも使っていない | 対象なし（運用実績なし） |
| sunset と移行手順 | **未定義**。v2 を出す判断のときに ADR で決める。決めること: 旧版を並行して提供する期間、`Deprecation`・`Sunset` ヘッダの有無、frontend の切替手順（frontend と backend は同一リリース単位で、版違いの組み合わせは運用しない） | なし（v2 が無いため運用していない） |
| 互換テスト（旧 consumer の期待を新 backend に当てる） | **なし**。consumer の期待を記録する仕組みが無く（api-11）、API の結果に互換テストの区分も無い | なし |
| DB スキーマの移行 | マイグレーションは前進のみ・冪等・トランザクション内（`migrations.test.js` の `[補助]` 5 件）。フェーズ2の期限項目追加（RISK-012、VIEW-042）は設計時に扱う | あり（フェーズ2は対象外） |
| 版の一致の検査 | `info.version`・`package.json`・タグが一致することを検査していない。health の `version` と `package.json` の一致は TC-075 | 一部 |

**v2 を出す必要が出る条件**: 項目の削除・型変更・必須化・エラーコードの意味の変更、またはページング導入による一覧の応答の形の変更（api-08 の見直し）。そのときは、oasdiff の差分、影響する frontend・テスト・監視（`monitoring/monitors.yaml` の API ジャーニーは契約スキーマで検証する）・k6 のスクリプトを洗い出してから切る。

## api-11 Consumer contract

**結論**: **Pact 等の consumer-driven contract は導入していない。** API の利用側は frontend だけ（外部連携なし。[ai-context.yaml](ai-context.yaml) の `consumer_contracts`）。利用側の期待を契約と突き合わせる**専用の自動検査は無い**。同等の役割を果たす手段が 4 つあるが、いずれも「利用側が期待している形を記録し、提供側へ当てる」ものではなく、足りない部分がある（下表）。改善計画を末尾に置いた。

**consumer（利用側）の実態**

| consumer | 何に頼っているか | 出典 |
|---|---|---|
| frontend（nginx 配信の静的 JS。唯一の利用側） | 一覧 `GET /api/v1/tasks` の `tasks` が配列であること（そうでなければ `INVALID_RESPONSE`）。各タスクの `id`・`title`・`completed`（`createdAt` は画面で使わず、並びは backend の順をそのまま使う）。追加 `POST` の 201 の本文（Task）、完了切替 `PATCH` の 200 の本文（Task）、削除 `DELETE` の 204。失敗はステータスと `error.code` だけを使う（`error.message` は使わない）。分岐するコードは `DATA_CORRUPT`・`TITLE_REQUIRED`・`TITLE_TOO_LONG`・`TITLE_MULTILINE` で、それ以外（`TASK_NOT_FOUND`・`INVALID_REQUEST`・`STORAGE_FAILURE`・5xx・通信失敗）は保存失敗の文言にまとめる | [frontend/src/api-client.js](../frontend/src/api-client.js)、`frontend/src/state.js`・`messages.js` |
| 外形監視（30 分ごと） | `openapi.yaml` のスキーマ（Task・TaskList・Error）で応答を検証し、ステータス・エラーコード・文言を確かめる。リリース済みのイメージに対して動く | `monitoring/monitors.yaml`、`scripts/monitoring/lib/schema.mjs` |
| 負荷試験（k6） | ステータスと、手書きの `isTask`（4 キー・UUID・真偽値・日時）で Task の形を確かめる。**契約のスキーマは読まず、契約の写しを手で持っている** | `perf/k6/lib/common.js` |

**利用側の期待を確かめている手段と、その限界**

| 手段 | 何を確かめているか | 限界（足りない部分） |
|---|---|---|
| A. 提供側の全応答の契約検証（api 層。api-04） | backend の応答が契約（`openapi.yaml`）に合う。frontend が使う項目は契約の必須項目 | 契約と frontend の**期待**が合っているかは見ない。契約が正しければ A で足りる前提 |
| B. frontend の `api-client.test.js`（unit、14 件） | リクエストの形（メソッド・パス・本文・ヘッダ）、201・204・各エラーコードの取り出し、JSON でない応答（UNKNOWN）、壊れた 2xx（INVALID_RESPONSE）、通信失敗の分類 | **偽の `fetch` と手書きのタスク（`TASK`）を使う**。手書きの応答が契約に合うことは検査していない（契約のスキーマで検証していない）。frontend の `MESSAGES` が backend の文言と一致することも自動では比べていない（ただし画面は文言をサーバーから取らず、`error.code` だけ使う） |
| C. e2e・compose（実際の frontend + 実際の backend） | 主要フロー（追加・完了切替・削除・再読込・保存失敗・破損）が結合して動く。観察値に frontend が実際に送った API 呼び出しの method・path・status が残る（例: TC-001） | 画面の結果と status を見る。応答本文のスキーマ適合は見ない。全エラーコード・全項目の網羅ではない |
| D. oasdiff（api-01・api-10） | 契約の破壊的変更を検出する | frontend が実際に使う項目かどうかは見ない（使わない項目の削除でも失敗し、使う項目の挙動変更は契約に出なければ見えない） |

つまり、**提供側の検証（A）と結合の検証（C）はあるが、利用側の期待そのものを契約へ突き合わせる部分（B の手書き応答の適合、利用側が使う項目・コード・ステータスの一覧の検証）が無い**。Pact を導入していない理由は、利用側が 1 つで、frontend と backend が同一リポジトリ・同一リリース単位であり、外部の consumer が無いため（[ai-context.yaml](ai-context.yaml)、`regression-15`）。ただし、frontend が使う項目が契約から外れてもテストが落ちない状態は、小さな投資で埋められる。

**足りない部分の改善計画（簡易 consumer contract）**

方針: Pact などの専用ツールは入れず、**frontend のテストが記録した期待を、backend のテストが検証する**簡易な仕組みにする。既存の Ajv（`backend/test/helpers/contract.js`）をそのまま使う。

| 段階 | 内容 | 担当 | 期限 | 完了の確認 |
|---|---|---|---|---|
| 1 | frontend の unit テストの偽の応答（`TASK` など）を、`openapi.yaml` のスキーマで検証する。契約が変わって手書きの応答が古くなったら、unit が落ちる。k6 の `isTask`（手書きの契約の写し）も、契約のスキーマで判定した結果と一致することを検査する | フロントエンド担当（実装）、QA 担当（レビュー）。k6 の分は運用（SRE）担当 | 2026-10-26 | 偽の応答に余分なキー・型違いを入れると unit が落ちる |
| 2 | frontend の `api-client.test.js` が、利用側の期待（呼ぶ operation = method + path、リクエスト本文の形、期待する成功ステータス、応答で使う項目と型、分岐するエラーコードの一覧）を JSON ファイルに書き出す。backend の `contract.test.js` が、(a) 各 operation が契約に宣言されている、(b) リクエスト本文が契約に合う、(c) 使う項目が契約の `required` で型が一致する、(d) 分岐するエラーコードが `Error.code` の列挙にある、(e) 実際の backend へ送った応答のステータスが期待と一致する、を検証する。**契約ジョブ（`contract:check`）に含め、違反で CI を止める** | バックエンド担当（検証側）、フロントエンド担当（記録側） | 2026-11-12 | 期待ファイルの項目を 1 つ消す・契約の項目名を変えると contract ジョブが落ちる。結果を `ConsumerContract` の形（consumer・tool・verified_at・result）で残す |
| 3 | Pact などへの移行の要否を判断する。判断条件: frontend と backend を別リリースにする、外部の consumer が現れる（`regression-15` の見直し条件と同じ） | プロダクトオーナー（判断）、QA リード | 2026-12-31（または条件が起きたとき） | ADR に判断を記録する |

これらは**未着手の計画**であり、担当・期限はプロダクトオーナーのマージによる承認の前は提案である（承認の扱いは末尾）。段階 1・2 が終わるまで、本観点は「利用側の期待の自動検証が無い」状態として扱う。

## api-12 データ・後始末

**結論**: すべての API テストが、**テストごとに専用の一時ディレクトリ・専用の SQLite ファイル・空きポート・固定の時刻と連番 ID**で backend を起動し、`afterEach` で必ず後始末する。テスト間で共有する可変の状態が無いため、並列に実行してもデータが混ざらない設計になっている。マルチテナントではないので、テナント分離は適用外（専用 DB がその代わり）。

| 項目 | 実装 | 出典 |
|---|---|---|
| 独立したデータ | `createSandbox()` が `mkdtemp` でテストごとの専用ディレクトリと DB パスを作る。`harness.start()` は専用の DB で backend を `port: 0`（空きポート）・`127.0.0.1` で起動する。データセットは `seedTasks()` で投入する（DS-001 空、DS-002 標準 3 件、DS-004 同時刻、DS-005 悪意ある文字列、DS-006 1,000 件、DS-007 破損、DS-008 書込み不可、DS-009 不正入力）。id は固定の UUID リテラル | `backend/test-support/`、`docs/data/datasets.csv` |
| 決定的な時刻・ID | `fixedClock`・`steppingClock`・`sequentialIdGenerator`・`sequentialRequestIds` を注入する（実時刻・乱数に依存しない）。性能の計測にだけ `performance.now()` を使う | `backend/test-support/clock.js` |
| 後始末（cleanup） | `harness.cleanup()` が起動した backend を止め、`sandbox.cleanup()` が**権限を戻したうえで**一時ディレクトリを削除する（DS-008 の読取専用のままでも消せる）。実プロセスは `spawnBackend().stop()`。すべて `afterEach` | `test/helpers/harness.js`、`test-support/sandbox.js` |
| 並列実行 | api テストは `node --test` の既定の並列度（ファイルごとに別プロセス）で動き、74 件が 13.2 秒（v1.0.0 の run）。ポート・ディレクトリ・DB が衝突しない。並列度は `TEST_CONCURRENCY` で調整できる。週次の nightly は全件を 3 回繰り返す | `backend/scripts/run-tests.js`、`nightly.yml` |
| 外形監視が作るデータ | 書込みを伴う API ジャーニーは、専用タイトル（`synthetic-<run_id>-MON-xxx`）で作り、成否にかかわらず DELETE する | `monitoring/monitors.yaml` の `data_cleanup` |

**テナント分離（適用外）**: テナントの概念が無い（1 インスタンス = 1 人用、DB は 1 ファイル）。理由・見直しは api-02 と同じ前提（EXC-001）に従う。**api-12 のテナント分離だけを対象外とする個別の承認行は無い**ため、プロダクトオーナーが PR #46 のマージで「テナント分離は適用外（専用 DB で代替）」を承認する提案として書いた（PR #46 のマージ＝AI の代行で承認された扱い。オーナーの確認は未実施）。見直し日 2027-01-12。認証を入れてテナント・利用者を持つなら、テナントごとのデータ分離と他テナントの操作のテストを足す。

**並列でも汚染しないことの直接の検証は、定常では行っていない**。設計（共有状態なし）と、並列・週次 3 回繰り返しで混在が無いこと（flaky の台帳に API 層で隔離中なのは性能の番兵 TC-073 のみで、原因は共有ランナーの負荷による絶対時間のしきい値。データの汚染ではない。ACT-002）が根拠。

## api-13 自動化・CI・報告

**結論**: API テストは PR・main への push・日次・週次・リリース（タグ）で自動実行され、結果は JUnit XML・CI 要約 JSON・テストごとの観察値 JSON に、**対象 SHA と run ID を付けて**保存される。失敗は集約ジョブ `ci-result` がゲートとして落とす。ただし、PR では変更影響で選んだテストだけが走る（全件は main・日次・リリース）こと、観察値は要約で応答の全文ではないこと、ゲートの強制が GitHub 側では未適用であることを、下に正直に書く。

**実行の契機と範囲**

| 契機 | ワークフロー | API テストの範囲 |
|---|---|---|
| PR | `ci.yml`（`unit-api`・`contract`） | `unit-api` は**変更影響で選択**（`quality/impact-map.yaml`。マップに無いパスの変更・差分が空なら全件にフォールバック）。`contract`（redocly・oasdiff・契約適合）は常に全件 |
| main への push | `ci.yml` | 全件 |
| 日次（毎日 UTC 18:00） | `nightly.yml` | backend の unit + api を全件 |
| 週次（日曜 UTC 20:00） | `nightly.yml` | 全件を 3 周（不安定さの検出） |
| リリース（タグ `v*.*.*`） | `release.yml` が `ci.yml` を再利用 | 全件。失敗したらリリースしない |
| 外形監視（30 分ごと） | `synthetic.yml` | リリース済みイメージに対する API ジャーニー（MON-002・MON-003 ほか）。API テストの結果ではないが、定期実行の API 検査（契約スキーマ検証つき）として補完する |

運用の実績はまだ短い（4 週間未満）。日次・週次の傾向（flaky の発生率など）は評価できない。

**機械可読な結果**

| 成果物 | 内容 | 場所 |
|---|---|---|
| JUnit XML | 全件実行は `all.xml`、選択実行は `unit.xml`・`api.xml`、契約は `contract.xml`。テスト名に TC-ID | CI の artifact `junit-coverage-unit-api`・`contract-report`（保持 90 日）。v1.0.0 の写しは `docs/evidence/runs/38152472087/junit/` |
| CI 要約 JSON | 層別の total・passed・failed・skipped・retried_success、ケース別の status・runs・layers・flaky、`commit_sha`・`run_id` | `ci-summary.json`（同 run） |
| 観察値 JSON | テストごとに、実際に送った API 呼び出し（method・path・status・要求と応答の要約）、環境（OS・Node）、`commit_sha`・`run_id`・`workflow`・`event`、outcome（passed / failed）。**失敗したテストにも書かれる** | `backend/test-results/observations/<TC-ID>.json`。v1.0.0 の写しは `docs/evidence/runs/38152472087/observations/backend/` |
| API 結果表（機械可読） | ケース ID を持つ API テスト 27 件 × endpoint × method（40 行）の、タグ（validation:*・error:*・idempotency・concurrency・retry・business・schema）・結果・`schema_validated`・`asserts_status`・`asserts_header`・`asserts_content_type`・観察値への参照・run。**対応表 `backend/test/api-tags.yaml`（人が決める）を、JUnit・観察値・テストの実装から機械的に検証して生成**する。宣言したタグに観察値の裏付けが無い（例: `error:4xx` なのに 4xx を観察していない）と生成が失敗する。アサートの有無はテストの実装から読む（テスト単位。同じ TC の複数の endpoint の行は同じ値）。`[補助]` 30 件・`[契約]` 6 件は観察値を残さないため含めない | `docs/data/api-results.csv`（`node scripts/evidence/build-api-results.mjs`）。数字は check-parity が本書の「検査の種類ごとの適用」の表と突き合わせる |
| 契約差分の結果 | oasdiff の結果（base・head の SHA、`result`、`reason`）と changelog・破壊的変更の JSON | `contract-report/result.json`（同 run の artifact） |
| カバレッジ | backend の行・分岐・関数。行 90% 未満で失敗 | `coverage-summary.json`（v1.0.0 は行 99.69%・分岐 98.09%） |
| 実施表・証拠索引 | 27 ケースの pass、run・SHA・観察値・JUnit への参照 | `docs/data/executions.csv`、`evidence-index.csv` |

**対象 SHA との紐づけ**: 実行は `TARGET_SHA`（PR では merge commit ではなく PR の head）をチェックアウトして行い、観察値・CI 要約・実施表のすべてに同じ SHA が入る（v1.0.0 は 5fcf40a7…、run `gh-run-38152472087`）。

**失敗の証拠**: 失敗したアサーションのメッセージに応答の本文が入る（`assertError` は `status: <応答本文>`、契約検証は契約と本文の JSON を出す）。JUnit に失敗の詳細、観察値に呼び出しの列が残る。**限界**: 観察値は要約（本文は 120 文字、呼び出しは 30 件まで、UUID は `{uuid}` に伏せる）で、**失敗したリクエストと応答の全文は残らない**。全文が要るときは JUnit の失敗メッセージとテストの再実行で補う。

**ゲート**: 集約ジョブ `ci-result` が `unit-api`・`contract` を含む全ジョブの success を要求し、skipped・cancelled も成功扱いにしない。retry で隠さない（API 層に retry は無い。`retried_success` は常に 0）。**ただし required check としての強制（Ruleset）は未適用で、main は GitHub 側では保護されていない**（[ai-context.yaml](ai-context.yaml)）。運用ルール「CI が赤のままマージしない」に頼る。

**このテストが実際に見つけた不具合（検出力の実績）**: DEF-005（TC-050。書込み不可で開いた SQLite 接続が、権限を戻しても書込み不可のまま。major、fixed）、DEF-015（TC-031。本文サイズ超過の応答が RST で失われ、テストが不安定。minor、fixed）。DEF-025（TC-073 の p95 が共有ランナーで不安定。minor、open。ACT-002、隔離は `quality/flaky-ledger.yaml` に期限付き）は環境差によるテストの不安定さで、API の不具合ではない。

**足りないこと**: ① 機械可読なタグ・アサートは `docs/data/api-results.csv`（ケース ID 付き 27 件）にある。ただし**テスト自身が出力するのでなく、人が書く対応表 `api-tags.yaml` を観察値・実装で検証して生成**しており、`[補助]` 30 件・`[契約]` 6 件は含まない。auth:*・paging・timeout・rate_limit・compat・tenant_isolation のタグは、該当するテストが無い（認証・ページング無し、timeout・rate limit のテスト無し）ため付けていない。② 全文の証拠。③ ゲートの GitHub 側の強制（Ruleset の適用は別手順）。改善は項番 5。

## できていないことと改善計画

| 項番 | できていないこと | 観点 | 計画 | 担当 | 期限 |
|---|---|---|---|---|---|
| 1 | consumer contract（利用側の期待を契約へ突き合わせる自動検査）が無い | api-11 | 簡易 consumer contract（api-11 の段階 1・2）。Pact 等の要否は段階 3 | フロントエンド担当・バックエンド担当 | 段階 1: 2026-10-26、段階 2: 2026-11-12、段階 3: 2026-12-31 |
| 2 | oasdiff が壊れた変更を止めることの自動確認が無い（api-01 の確認は手動 1 回） | api-01・api-10 | base と改変版の 2 つの契約を固定のファイルで持ち、oasdiff が「壊れた変更は失敗・追加のみは成功」になることを、イメージを更新する PR で自動検査する。結果は互換テスト（`compat`）として記録する | QA 担当 | 2026-11-12 |
| 3 | 同じ id への並列 PATCH、PATCH と DELETE の競合、PATCH の逆順到着、POST の重複送信（API 直接）が未検証 | api-07 | 新規ケースを起票し（`docs/data/cases.csv` への追加は成果物 03 の担当へ依頼）、`concurrency.test.js` に足す | QA 担当・バックエンド担当 | 2026-11-12 |
| 4 | `GET /api/v1/tasks` の 503 を HTTP で再現していない。PATCH の壊れた JSON のテストが無い | api-03・api-04・api-06 | 読み取り時に失敗するストアの差し替え（または DB ファイルを読めない権限にする案）で一覧の 503 を再現する。PATCH に壊れた JSON を送るケースを `robustness.test.js` に足す | バックエンド担当 | 2026-11-12 |
| 5 | API の結果の機械可読なタグを、テスト自身が出力していない（対応表 `api-tags.yaml` + 生成で代替。`[補助]`・`[契約]` は対象外） | api-13 | 観察値（`observe-node-test.js`）に、endpoint・method・タグ・`schema_validated`・アサートの種類をテストから直接足し、`[補助]`・`[契約]` にも観察値を残して、対応表を不要にする | バックエンド担当 | 2026-11-30 |
| 6 | `info.version`・`package.json`・タグの版の一致を検査していない | api-10 | `contract.test.js` に一致の検査を足す | バックエンド担当 | 2026-11-12 |
| 7 | `Cache-Control: no-store` が無い。`x-request-id`・末尾スラッシュ・本文上限が契約に未記載 | api-04・api-01 | ヘッダの追加は ACT-005（期限 2026-12-31）。契約へ非破壊の追加として書くかを決める | バックエンド担当・プロダクトオーナー | 2026-12-31 |
| 8 | rate limit・サーバー側の timeout・backoff が無い | api-09 | 設計判断として受容（api-09）。見直し条件に当たったら実装する | プロダクトオーナー | 見直し日 2027-01-12 |
| 9 | main の Ruleset が未適用で、`ci-result` がマージの必須条件として強制されていない | api-13 | 適用はメンテナが `.github/settings/README.md` の手順で行う（本書の範囲外。ADR-0004） | メンテナ | 未定 |

上の項番は未着手の**計画**で、GitHub の Issue・実施表のアクション（`docs/data/actions.csv`）には**まだ起票していない**（アクションへの登録は成果物 12 の担当へ依頼する）。担当・期限はプロダクトオーナーのレビューで確定する。

## 再現手順

| 目的 | コマンド（リポジトリのルート。Node.js 24。ツールは mise で管理） |
|---|---|
| API テストを全件実行 | `npm run test:api -w backend`（JUnit は `backend/test-results/api.xml`） |
| 契約適合だけを実行 | `npm run contract:check -w backend` |
| 契約の lint | `npm run contract:lint` |
| 破壊的変更の検出（Docker が要る） | `bash scripts/ci/oasdiff-breaking.sh`（`PR_BASE_SHA` で比較元を指定できる。結果は `contract-report/`） |
| 実行する層を直列にして競合を疑う | `TEST_CONCURRENCY=1 npm run test:api -w backend` |
| docs の参照・リンク | `node scripts/ci/docs-check.mjs` |

## 付録 ケース ID を持つ API テスト 27 件の索引

行の正本は `docs/data/cases.csv`。ここには、ケースが**どの endpoint を何の観点で検証するか**（cases.csv に無い対応）だけを示す。status・契約スキーマ・content-type は、TC-073 を除き全件で検証している（api-04）。全件が v1.0.0 の run で pass。

| TC | テストファイル | endpoint（status） | 種別（観点） |
|---|---|---|---|
| TC-009 | update-delete | E3（200）、E1 | 状態遷移・冪等（同値再送）・DB 整合 |
| TC-010 | update-delete | E3（400） | 未知フィールド・必須・型・不変項目 |
| TC-011 | update-delete | E3・E4（404）、E4（204） | 404 コード・削除済みの復活なし・順序 |
| TC-012 | update-delete | E3・E4（400） | 形式（UUID）・境界（長い id） |
| TC-015 | update-delete | E4（204・404） | 削除・再削除（重複送信） |
| TC-030 | create-validation | E2（201） | 境界（100 文字）・`Location` なし |
| TC-031 | create-validation | E2（422） | 境界（101 文字・10 万文字） |
| TC-032 | create-validation | E2（422） | 必須（空・空白・タブ・改行） |
| TC-033 | create-validation | E2（422） | 形式（改行） |
| TC-034 | create-validation | E2（201） | 形式（前後空白の除去） |
| TC-035 | create-validation | E2（400） | 必須・型・不正 payload |
| TC-036 | create-validation | E2（400） | 未知フィールド・壊れた JSON |
| TC-037 | contract | E1（200）、E2（201） | 契約スキーマ・UUID v4・UTC・余分なキーなし |
| TC-038 | list-order | E1（200）、E2 | 並び順（createdAt 降順） |
| TC-039 | list-order | E1（200） | 安定順序（同時刻・再起動） |
| TC-042 | persistence | E1・E2・E3 | 再起動後の永続性 |
| TC-050 | storage-failure | E2（503） | 5xx・部分失敗なし・再試行 |
| TC-051 | storage-failure | E3・E4（503） | 5xx・部分失敗なし |
| TC-052 | data-corrupt | E1（500） | 5xx・破損の検知・非上書き |
| TC-053 | data-corrupt | E2・E3・E4（500） | 5xx・非上書き（11 種の行破損を含む） |
| TC-054 | data-corrupt | E5（503）、E1（500） | health の劣化・復旧 |
| TC-059 | security | E1〜E4（200・201・204・422） | 認証なしで使える（401・403 なし）・直接 API の不正入力 |
| TC-060 | security | E2（201）、E1 | HTML・SQL 断片が変換・実行されない |
| TC-064 | concurrency | E2（201 ×20） | 並列更新 |
| TC-065 | concurrency | E4（204・404 ×9） | 並列削除・冪等 |
| TC-073 | performance | E1・E2（200・201） | 性能の番兵（契約検証なし） |
| TC-075 | contract | E5（200） | health の 4 キー・版・commit |

## 承認と限界

- **承認**: 本書の承認は、プロダクトオーナー（リポジトリオーナー）が PR をマージした時点とする。フェーズ1の PR のマージは、オーナーの明示許可（2026-10-11）に基づく AI の代行である。**本書は draft のまま**（PR #46 は 2026-10-12 にマージ済みだが、AI の代行で、オーナーの確認は未実施）。api-02・api-08 の対象外は、すでにマージ済みの PR #40（ai-context.yaml の EXC-001・EXC-002）と PR #41（01 テスト計画書の plan-03）で承認されたものと同じ内容。api-09 の rate limit の設計判断、api-12 のテナント分離の適用外、改善計画の担当・期限は、**本書のマージ（PR #46。AI の代行）をもって承認された扱いの提案**で、オーナーの確認は未実施である。
- **レビューの限界**: 作成は AI、レビューは QA リード（作成者と同じロールの兼務）で、第二の目は無い。独立したレビューは未実施。
- **証跡の限界**: 数字の出典は v1.0.0 のタグ run（`gh-run-38152472087`）に限る。運用の実績は短い（4 週間未満）。実施表の再生成は main に取り込み済みで、27 ケースの数と run を 2026-10-12 に再確認した。oasdiff の検出力の確認（2026-10-12）は手動で、CI の記録ではない。
- **未検証の事実**: 「同一プロセス内で要求が割り込まない」（api-07）、「frontend が `createdAt` を使わない」（api-11。コードを読んで確認した）は、テストではなく設計とコードの読解に基づく。

## 変更履歴

| 版 | 日付 | 内容 | 作成 | レビュー | 承認 |
|---|---|---|---|---|---|
| 1.0 | 2026-10-12 | 初版（API テストの 13 観点・網羅表・対象外・改善計画） | QA 担当（AI エージェントが作成） | QA リード（未実施） | プロダクトオーナー（PR #46 のマージ＝承認の代行。オーナーの確認は未実施） |
| 1.1 | 2026-10-12 | 横断整合（時点依存の記述を現状へ）: 実施表・証跡が main に取り込み済み（PR #42）、状態・承認の書き方を 01〜13 で統一 | QA 担当（AI エージェントが作成） | QA リード（未実施） | プロダクトオーナー（PR のマージ＝承認の代行。オーナーの確認は未実施） |
