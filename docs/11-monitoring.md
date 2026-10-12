# 11 外形監視・運用品質成果物

| 項目 | 内容 |
|---|---|
| 文書ID | DOC-11 |
| 版 | 1.1 |
| 更新日 | 2026-10-12 |
| 状態 | draft（オーナーの確認待ち。PR マージ＝承認の代行） |
| 対象 | todo-app 仕様書 v1.1（spec/todo-phase1-spec.html）、リリース v1.0.0（commit 5fcf40a7e58dc253e53ff56860d0669a69abda26） |
| 作成 | 運用（SRE）担当（ロール。実作業は AI エージェント） |
| レビュー | QA リード（未実施。作成者と別ロールだが兼務で、第二の目は無い） |
| 承認 | プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ。オーナーの確認が済むまで draft のまま） |
| 正本 | この md と、[monitoring/](../monitoring/README.md)（`monitors.yaml`・`alert-routes.yaml`・`maintenance.yaml`・`target.yaml`・`runbooks/`・`alert-tests.md`・`fp-fn-log.md`・`drills/`・`history/`）、`.github/workflows/synthetic.yml`、`scripts/monitoring/`、`e2e/synthetic/`（Git が版管理） |

本書は、v1.0.0 の重要ジャーニーを**外から継続的に確かめ**、異常を検知して人に知らせ、対応し、学びを開発へ戻す仕組みの**判断と実績**をまとめる。**版 1.1（2026-10-12）で、PR #51〔2026-10-11T16:30Z マージ〕の内容と、その後に始まった schedule 実行の実績（2026-10-12 17:00 JST〔08:00 UTC〕時点）を反映した**（初版は PR #51 より前の値で、Actions 上の通知試験が未実施・実行が手動 2 回・schedule 0 件と書いていた）。
設定そのもの（監視・経路・runbook）は `monitoring/` が正本で、本書は方針・読み方・実績・できていないことを書く。**数字はすべて出典（パス・Issue・run）を付けた**。

## 結論

- **監視 13 件（有効 11・無効 2）**。重要ジャーニー J-01〜J-05（[quality/journeys.yaml](../quality/journeys.yaml)）の **5 件すべて**が http / api / browser の監視で守られている（J-01〜J-04 は API と browser、J-05 は API）。ping だけの監視は無い（monitoring-02）。
- 全監視が service・SLI・SLO（`perf/slo.yaml` の metric）・利用者影響・severity に紐づく。通知経路 3 本が 13 件すべてを覆い、runbook 5 本はいずれも一次対応・切り分け・rollback・連絡経路の 4 節を持つ（monitoring-01・07・08）。
- 監視・経路・runbook・実行・通知試験のすべてを Git で管理し、設定の整合は `check-config.mjs` と単体テスト 34 件で検査する（monitoring-10。2026-10-12 に手元で 34 件 pass・`[check-config] OK` を確認。PR #51 から PR の CI（`ci.yml` の lint ジョブ）でも動く）。
- **本物のインシデントが 2 件ある**。①#36: MON-008 の**誤検知**で、原因は製品の挙動修正（PR #12）に監視の `check()` が追随していなかったこと。検知から Issue 起票まで約 37 秒、回復で自動 close、defect・テスト・監視・runbook・PR テンプレートへ還流した（monitoring-12・14）。②#59（2026-10-12 06:36 UTC）: 死活監視 `monitoring-watchdog.yml` が「`synthetic.yml` の最終実行が 5.3 時間前」を検知して `[sev3][MON-META] 外形監視が 3 時間以上実行されていない` を起票し、次の schedule 実行（08:00 UTC）が成功して自動 close した（約 84 分。monitoring-07）。**これは誤検知ではなく、schedule が 30 分ごとに動いていない実態を捉えた本物の検知**。
- **できていないこと（正直に）**。
  - **定期実行（schedule）の履歴はまだ短く、指定の 30 分間隔で動いていない**。2026-10-12 17:00 JST（08:00 UTC）時点で、`event=schedule` の実行は計 8 件（`gh api repos/bsj-fujimoto/todo-app/actions/runs?event=schedule` の total_count = 8）: `synthetic.yml` が 4 回（2026-10-11 18:01・21:52、2026-10-12 01:16・07:57 UTC。**すべて release モード・成功・監視 11/11**）、死活監視 `monitoring-watchdog.yml` が 2 回（22:29・06:35 UTC。ともに成功）、nightly が 2 回。**実際の間隔は 3 時間 24 分〜6 時間 41 分で、cron（`7,37 * * * *`＝30 分ごと）を大きく外れる**（GitHub の schedule の遅延・欠落。monitoring-06）。それ以前（〜2026-10-11 17:20 UTC）は 0 件だった。`synthetic.yml` の Actions 実行は計 9 回（手動 5〔通常 2・通知試験 3〕＋ schedule 4）。**成功率（`availability_synthetic_ratio` ≥ 0.99）は評価できない**（schedule の標本が 4 で、30 日の約 1,440 回に遠く、間隔も 30 分でないため。monitoring-11）。
  - **リリース済みイメージ（v1.0.0。digest 固定）を監視した実績**: schedule の 4 回（すべて `mode: release`、11/11 成功）と通知試験 2 回（run 38154528493・38155028980）。手動の通常実行 2 回（#36 の誤検知とその回復確認）はフォールバック（main の HEAD をビルド）だった（monitoring-13）。
  - **DNS・TLS 証明書は検証できない**（MON-011・MON-012 は `enabled: false`）。runner 内の localhost は HTTP だけで、本番ドメインと実証明書が無い（monitoring-04）。
  - **多地点・地域監視はできない**（GitHub-hosted runner 1 か所）。**実行間隔の定義は 1800 秒**（30 分）で、既定の上限 300 秒を満たさない。**しかも実績の間隔は 3〜7 時間**（monitoring-03・06）。
  - **通知が人に届いたかは観測できない**。観測できるのは「Issue が作られた」「assignee が設定された」まで。外部通知（メール・チャット・電話）は無く、連絡先はメンテナ 1 名だけ（monitoring-07）。
  - 認証が無いため、認証付き監視・テストアカウントは対象外（monitoring-05。承認は下記のとおり**マージ時**）。
  - **監視基盤自身の沈黙への対策は PR #51（2026-10-11T16:30Z マージ）で入った**。設定の検査は PR の CI にも入った（`ci.yml` の lint ジョブ）。実行基盤の失敗は `meta-alert` が `[sev3][MON-META]` で起票する（run 38155036726 の基盤試験で pass）。**死活監視（`monitoring-watchdog.yml`）は schedule で 2 回動き、2 回目（2026-10-12 06:35 UTC）に実際に MON-META を起票して動作を確認できた（#59）**。ただし死活監視自身も GitHub の schedule で動くため、schedule が止まれば一緒に止まる（同じ基盤の死活は同じ基盤では監視できない。monitoring-10・RB-005）。

## 前提と読み方

- **本番環境が無い**（[SECURITY.md](../SECURITY.md)、[docs/ai-context.yaml](ai-context.yaml) の `product.criticality: low`）。そのため監視の対象は、**リリース済みコンテナイメージ（GHCR・digest 固定）を GitHub Actions の runner で compose 起動し、localhost に対して実行したもの**になる。リリースが引けないときは main の HEAD をビルドして起動する（フォールバック。run の summary に対象を明記）。確かめているのは「リリースしたイメージが起動して主要ジャーニーが通ること」で、**本番の可用性ではない**（[monitoring/README.md](../monitoring/README.md) 設計判断 1）。
- 利用者は 1 人（1 インスタンス = 1 人。認証なし）。サービス区分は best-effort で、SLA は無い（`ai-context.yaml` の `product.service_tier`）。SLO の目標値は**実測ではなく想定**を含む（`perf/slo.yaml` の `basis`）。
- 実行の流れ: `synthetic.yml`（30 分ごと + 手動）→ 対象の決定（`resolve-target.mjs`）→ compose 起動 → デプロイマーカー記録（`marker.mjs`）→ 監視の実行（`run-monitors.mjs`）→ 監視が失敗なら incident Issue（`alert.mjs`、`alert` ジョブ）→ 結果を artifact に 90 日保存。監視の結果が出る前に実行基盤が失敗したときは `meta-alert` ジョブが `[sev3][MON-META]` を起票する（`issues: write` を持つのは `alert`・`meta-alert` と、死活監視 `monitoring-watchdog.yml` の `watch`）。

## 監視一覧（監視ごとの表）

正本は [monitoring/monitors.yaml](../monitoring/monitors.yaml)（`check-config.mjs` が必須項目・`slo_ref` の解決・経路・runbook を検査する）。下表は 2026-10-12 時点の写し。
共通の既定値（`defaults`）: **service** = `todo-app`、**regions** = `github-hosted-runner（リージョン非固定）`、**locations** = 1、**interval** = 1800 秒、**auth** = `none`（`inline_credentials: false`）、**PII 方針** = 個人情報を使わない合成データのみ（タイトルは `synthetic-<run_id>-…`）、**定義ファイル** = `monitoring/monitors.yaml`。

### 何を・何のために見るか

| monitor_id | 種別 | target | journey | SLI | SLO 参照（slo_ref・目標） | 利用者影響（severity） |
|---|---|---|---|---|---|---|
| MON-001 | http | `GET /` | J-01 | frontend が画面（HTML）を返せる割合 | `availability_synthetic_ratio` ≥ 0.99 | 画面が開けず、追加・確認・完了・削除が一切できない（sev1） |
| MON-002 | http | `GET /api/v1/health` | なし（サービス監視） | health が status=ok・db=ok を返す割合、応答 p95 | `health_p95_ms` ≤ 200 ms | backend 停止・DB 異常。保存と読み込みができない（sev1） |
| MON-003 | api | `POST /api/v1/tasks` → `GET` → `DELETE` | J-01 | タスクを追加して一覧に現れるまで成功する割合、追加 p95 | `api_create_p95_ms` ≤ 300 ms | 追加したタスクが保存されない・一覧に出ない（sev2） |
| MON-004 | api | `POST` → `PATCH` → `GET` → `PATCH` → `DELETE` | J-02 | 完了状態を切り替えて反映される割合、更新 p95 | `api_update_p95_ms` ≤ 300 ms | チェックを入れても状態が変わらない・戻る（sev2） |
| MON-005 | api | `POST` → `DELETE` → `GET` → `DELETE`（404） | J-03 | 削除したタスクが一覧から消える割合、削除 p95 | `api_delete_p95_ms` ≤ 300 ms | 消せない・消したものが復活する（sev2） |
| MON-006 | api | `POST /api/v1/tasks`（空・101 文字・改行・不正本文）と件数の確認 | J-04 | 不正な入力を保存せず規定のエラーで返す割合 | `error_rate` < 0.01 | 不正入力が保存される・原因が分からないエラーになる（sev2） |
| MON-013 | api | `GET /api/v1/tasks` | J-05 | 一覧取得が 200・契約どおりで DATA_CORRUPT でない割合 | `api_list_p95_ms` ≤ 500 ms | 保存データが壊れ、以降の読み書きが止まる（sev1） |
| MON-007 | browser | `/`（Playwright。追加 → 再読込） | J-01 | 画面から追加し、再読込後も表示される割合、画面表示完了までの時間 | `screen_ready_ms` ≤ 2000 ms | 画面操作で追加できない・再読込で消える（sev2） |
| MON-008 | browser | `/`（チェック → 再読込で保持） | J-02 | 画面のチェック操作が反映・保持される割合 | `api_update_p95_ms` ≤ 300 ms | チェックしても状態が保持されない（sev2） |
| MON-009 | browser | `/`（削除ボタン → 再読込でも消えたまま） | J-03 | 画面の削除操作が反映・保持される割合 | `api_delete_p95_ms` ≤ 300 ms | 削除したものが消えない・復活する（sev2） |
| MON-010 | browser | `/`（空入力 → エラー表示・件数不変） | J-04 | 画面が不正入力を弾き規定の文言を出す割合 | `error_rate` < 0.01 | 不正入力でエラーが出ない・保存される（sev2） |
| MON-011 | tls（**無効**） | `https://<本番ドメイン>:443` | なし | 証明書の残り有効日数 | `availability_synthetic_ratio` ≥ 0.99 | 失効するとブラウザが警告し画面に到達できない。予兆の警告は残り 14 日未満が sev3、7 日未満が sev2、失効後は MON-001 が sev1 で検知する |
| MON-012 | dns（**無効**） | `<本番ドメイン>` | なし | 名前解決の成功と解決先の一致 | `availability_synthetic_ratio` ≥ 0.99 | 名前が引けず到達できない（sev1） |

### どう実行し、何を確かめ、どう後始末するか

| monitor_id | interval | timeout（1 試行） | retry（最大試行） | assertions（種別） | auth | 後始末（data_cleanup） |
|---|---|---|---|---|---|---|
| MON-001 | 1800 秒 | 10 秒 | 2（3 回） | status 200 / content「My TODO」/ header（CSP）/ latency 2,000 ms | none | 作成なし（読み取りのみ） |
| MON-002 | 1800 秒 | 10 秒 | 2（3 回） | status / schema（Health）/ content（status=ok・db=ok・version・commit）/ latency 200 ms | none | 作成なし |
| MON-003 | 1800 秒 | 20 秒 | 1（2 回） | status / schema（Task・TaskList）/ content（一覧に含まれる）/ latency 300 ms | none | 作った task_id を成否にかかわらず DELETE（404 は許容） |
| MON-004 | 1800 秒 | 20 秒 | 1（2 回） | status / schema / content（completed の切替が一覧にも反映）/ latency 300 ms | none | 同上 |
| MON-005 | 1800 秒 | 20 秒 | 1（2 回） | status（204・404）/ schema（Error）/ content（TASK_NOT_FOUND）/ latency 300 ms | none | 自身で削除。途中失敗に備え DELETE（404 許容） |
| MON-006 | 1800 秒 | 20 秒 | 1（2 回） | status（422・400）/ schema（Error）/ content（error.code と日本語メッセージ、件数不変） | none | 作成しない設計。万一保存されたら件数差で失敗にし、自動削除はしない（実データを消さないため） |
| MON-013 | 1800 秒 | 20 秒 | 1（2 回） | status 200 / schema（TaskList）/ content（DATA_CORRUPT を含まない）/ latency 500 ms | none | 作成なし |
| MON-007 | 1800 秒 | 60 秒 | 1（2 回） | status 200 / content（追加が表示され再読込後も残る）/ latency 2 つ（開く → 入力欄が使える〔一覧の取得完了〕まで `screen_ready_ms` 2,000 ms、ジャーニー全体 `journey_ms` 10,000 ms） | none | UI で削除し、`afterEach` で API からも DELETE |
| MON-008 | 1800 秒 | 60 秒 | 1（2 回） | status 200 / content（完了表示が再読込後も保持） | none | 同上 |
| MON-009 | 1800 秒 | 60 秒 | 1（2 回） | status 200 / content（削除後は再読込でも表示されない） | none | 自身で削除。`afterEach` で DELETE（404 許容） |
| MON-010 | 1800 秒 | 60 秒 | 1（2 回） | status 200 / content（「タスク名を入力してください」・件数不変） | none | 作成しない設計。作られたら `afterEach` で検知して失敗 |
| MON-011 | 86400 秒 | 10 秒 | 2（3 回） | tls_expiry（残り 14 日以上） | none | 作成なし |
| MON-012 | 3600 秒 | 10 秒 | 2（3 回） | dns（A レコードが期待 IP と一致） | none | 作成なし |

集計（`monitors.yaml` から数えた）: 有効 11 件の assertions はすべて status と content を含み、schema（openapi.yaml の契約）を持つものは 6 件（MON-002〜006・013）、latency を持つものは 7 件（MON-001〜005・007・013。MON-007 は latency の assertion を 2 つ持つ）。**ping 監視は 0 件**。

## monitoring-01 Service・SLO対応

**結論**: 13 件すべてが **service**（`todo-app`）・**SLI**・**SLO 参照**（`perf/slo.yaml` の metric。`check-config.mjs` が実在を検査）・**利用者影響**を持つ（上の表）。SLO の目標値と根拠（`provisional-confirmed` / `assumed`）の正本は [perf/slo.yaml](../perf/slo.yaml)。

**サービス（service）**: `todo-app`（frontend nginx + backend Fastify/SQLite）。サービス区分は best-effort で、SLA は無い（`ai-context.yaml` の `product.service_tier`）。

**SLO と監視の対応**:

| SLO（`perf/slo.yaml`） | 目標・根拠 | 対応する監視 | 利用者が困ること |
|---|---|---|---|
| `availability_synthetic_ratio` | ≥ 0.99・assumed。30 分ごとの実行の成功率 | MON-001（と、有効化後の MON-011・012） | 画面が開けない・使えなかった時間 |
| `health_p95_ms` | ≤ 200 ms・assumed | MON-002 | 死活判定が遅れ、監視自体が誤報する |
| `api_create_p95_ms` | ≤ 300 ms・provisional-confirmed | MON-003 | 追加ボタンから一覧反映までの待ち |
| `api_update_p95_ms` | ≤ 300 ms・assumed | MON-004・MON-008 | チェックから反映までの待ち |
| `api_delete_p95_ms` | ≤ 300 ms・assumed | MON-005・MON-009 | 削除から行が消えるまでの待ち |
| `api_list_p95_ms` | ≤ 500 ms・provisional-confirmed | MON-013 | 起動・再読込のたびの待ち |
| `screen_ready_ms` | ≤ 2000 ms・provisional-confirmed | MON-007 | 開いてから使えるまでの待ち |
| `error_rate` | < 0.01・provisional-confirmed | MON-006・MON-010 | 「ときどき保存できない」 |

**SLO 違反の説明と判断**: 監視の失敗は `user_impact` の文言と severity（sev1〜3。定義は `alert-routes.yaml`）を付けて incident Issue に出る。severity が「何を優先して直すか」と ack の目標時間（sev1・sev2 は 24 時間、sev3 は 72 時間）を決める。**判断に使った実例は #36 の 1 件だけ**で、sev2 の影響文言（チェックが保持されない）を手がかりに調べ、製品は正しく監視が古い（誤検知）と結論した。

**正直な限界（SLO との結び付きの弱いところ）**:

- **SLI は「実行ごとの成功か失敗か」、SLO の多くは「p95 の応答時間」で、型が違う**。監視の latency assertion は**1 回の応答が目標以下か**を見るだけで、p95 そのものは測らない（p95 は性能試験 `perf/` が測る）。MON-004・005・008・009 の SLO 参照は latency の SLO を指すが、SLI の文言は成功率で、対応は緩い。
- **`availability_synthetic_ratio` は評価できない**（実行履歴は手動 5 回 + schedule 4 回で、schedule の間隔も 30 分でない。monitoring-11）。SLO 違反を理由にした判断は、まだ 1 度も無い。
- **MON-007 の「画面表示完了 2,000 ms」の定義と実装の食い違いは、PR #51（2026-10-12 マージ）で解消した**。以前は `monitors.yaml` が `screen_ready_ms`（2,000 ms）の確認と書くのに、`e2e/synthetic/journey.spec.js` は追加・再読込までを含めて 10 秒以内だけを見ていた。現在は spec が、開く → 入力欄が使える（一覧の取得完了）までを `performance.now()` で測り、上限（`monitors.yaml` の assertions の `limit_key: screen_ready_ms`、2,000 ms）を超えたら失敗にする。ジャーニー全体の 10,000 ms（`journey_ms`）は別の assertion に分けた。`check-config.mjs` が、limit_key の有無・spec がそのキーを使うこと・既定値が定義と同じであることを検査する（PR #51 の本文によれば、手元の実測で `ready` は 64.8 ms、上限を 1 ms にすると失敗することも確認）。**この 2,000 ms の判定は、PR #51 のマージ後の schedule 実行 4 回（c14d39a 以降。MON-007 はすべて ok）で Actions 上でも動き、成功した**。ただし `results.json`・`run-history.jsonl` に記録されるのはジャーニー全体の所要（約 1.3 秒）と ok・fail だけで、`ready` の実測値そのものは記録していない（記録するかは未決）。1,000 行描画の 2,000 ms は引き続き `perf/` 側（`scripts/perf/screen`）が測る。
- MON-001 の latency 2,000 ms と MON-013 の 500 ms は、前者に対応する SLO が無い（`availability_synthetic_ratio` を参照）。

## monitoring-02 重要Journey coverage

**結論**: 重要ジャーニー **5 件中 5 件**（100%）に、http / api / browser の監視がある。ping 監視は 0 件。ジャーニーの定義は [quality/journeys.yaml](../quality/journeys.yaml) と同じ（回帰の `journey_id` と揃えてある）。ログイン・購入・検索はこの製品に無い（認証なし、機能は追加・完了・削除のみ）。

| ジャーニー | 重要な理由（`journeys.yaml`） | http / api | browser | 重大度 |
|---|---|---|---|---|
| J-01 追加して再読込しても残る | データ損失（RISK-001）が最大のリスク | MON-001（画面の配信）、MON-003 | MON-007 | sev1（配信）／ sev2 |
| J-02 完了を切り替えると画面と保存データに反映 | 完了管理が本来の用途 | MON-004 | MON-008 | sev2 |
| J-03 削除すると一覧と保存データから消える | 取り消せない操作 | MON-005 | MON-009 | sev2 |
| J-04 不正入力が弾かれ、保存データが変わらない | 検証抜け（RISK-002） | MON-006 | MON-010 | sev2 |
| J-05 保存失敗・破損でもデータを守る | 失敗を成功と誤認させない・壊れたデータの上に書かない（RISK-003・RISK-004） | MON-013 | **なし** | sev1 |

- **優先順位**: データを失う J-01・J-05 と、画面が開けない MON-001・サービス死活の MON-002 を sev1 にした。操作が壊れる J-02〜J-04 は sev2。
- **見ていないこと**: J-05 の「保存に失敗しても耐える」側（書込み不可・容量不足の注入）は、本番相当の環境で障害を注入できないため外形監視では見ない。API・E2E のテスト（TC-045〜TC-055 など）が担当する。外形監視が見るのは「保存データが壊れていないか（DATA_CORRUPT になっていないか）」だけ。J-05 に browser の監視は無い（壊れたデータの画面表示は E2E が担当。MON-013 は API で直接検知できるため、browser を足す根拠が弱い）。
- **MON-002 はジャーニーではなくサービス監視**（`journey_id` は空）。runbook の網羅（monitoring-08）ではジャーニーを持つ監視 10 件のほか、MON-002 も RB-002 に含めている。

## monitoring-03 Synthetic範囲・地域

**結論**: 種別は **http（2）・api（5）・browser（4）**の 3 種を目的別に使い分けた。**地域は 1 か所**（GitHub-hosted runner。リージョン非固定）で、多地点監視は**できない**。

| 目的 | 種別 | 選んだ理由 | 監視 |
|---|---|---|---|
| 画面が配信されるか・セキュリティヘッダ | http | 最も軽く、nginx の停止・設定ミスを秒単位で検知できる | MON-001 |
| backend の死活・DB・動いている版（デプロイマーカー） | http | JSON の内容（status・db・version・commit）まで確かめる | MON-002 |
| 操作の結果が保存され、API 契約どおりか | api | 画面を介さず、`backend/openapi.yaml` のスキーマで厳密に検証でき、安定して速い | MON-003〜006・013 |
| 利用者が実際に触る経路（描画・クリック・再読込） | browser（Playwright、Chromium のみ） | DOM・CSP・スクリプト読み込みなど、API では見えない壊れ方を捕まえる | MON-007〜010 |

- **地域**: `regions` は実行環境をそのまま書いた（`github-hosted-runner（リージョン非固定）`、`locations: 1`）。**選定理由を「利用者分布」と結び付けることはできない**。利用者は 1 人で本番が無く、地域ごとの到達性という概念が成り立たないため。本番（独自ドメインと複数地域の利用者）を持つなら、利用者の分布に合わせた複数リージョンから実行する（`monitoring/README.md` の「検証できないもの」）。
- **ブラウザの種類**: 監視は Chromium（Desktop Chrome）だけ。E2E は 4 project だが、外形監視は「繋がるか・主要経路が通るか」が目的で、ブラウザ互換は E2E に任せた。
- **限界**: runner 内の localhost への実行なので、**ネットワーク経路（DNS・TLS・CDN・回線）は一切通らない**（monitoring-04）。

## monitoring-04 DNS／TLS／HTTP／Content

**結論**: **HTTP と Content は検証している。DNS と TLS は定義するが無効**で、実際には検証していない。

| 層 | 状態 | 内容 |
|---|---|---|
| **HTTP（status）** | 検証している（有効 11 件すべて） | 200 / 201 / 204 / 404 / 422 / 400 を、操作ごとに期待値と照合 |
| **Content（内容）** | 検証している（有効 11 件すべて） | 画面の見出し「My TODO」、JSON の値（`status=ok`・`db=ok`・`completed` の切替・`error.code`・日本語メッセージ）、一覧への含まれ方、`DATA_CORRUPT` を含まないこと、ブラウザの表示と再読込後の保持 |
| 契約（schema）・ヘッダ・応答時間 | 検証している | `backend/openapi.yaml` の Task・TaskList・Health・Error に適合（`additionalProperties: false`・enum・UUID・日時形式）、CSP ヘッダ（MON-001）、応答時間（MON-001〜005・007・013） |
| **TLS 証明書の期限** | **無効**（MON-011、`enabled: false`） | 本番ドメインと実証明書が無い。runner 内の localhost は HTTP のみで、TLS 終端を compose に足さない前提。有効化すると残り 14 日未満で警告 |
| **DNS 解決** | **無効**（MON-012、`enabled: false`） | 本番ドメインが無い。runner 内は compose のサービス名と localhost で、実 DNS の解決・伝播は検証できない。有効化すると A / AAAA / CNAME の解決先を期待値と照合 |

- 無効にした理由は `monitors.yaml` の `disabled_reason` と [monitoring/README.md](../monitoring/README.md) の「検証できないもの」に書いてあり、**実施したことにはしていない**（実行の summary でも `SKIP` と表示される。`monitoring/history/20261011T0720Z-local/summary.md`）。
- 承認済みの対象外: TLS・DNS の監視は [01 テスト計画書](01-test-plan.md)（plan-03）で「定義はあるが無効」として扱い、**本番ドメインを持つとき**に有効化する（見直し日は plan-03 を参照）。これは monitoring-04 を採点の分母から外すものではない。**この観点は満点の条件（TLS・DNS・HTTP・Content をすべて検証）を満たしていない**。
- 設定上の食い違い（PR #51 で解消）: 以前は MON-011・012 の `user_impact` が「sev1 相当」で、通知経路は RT-SEV3、`monitoring/README.md` は「残り 14 日未満で警告（sev3）、7 日未満で sev2」と書き、食い違っていた。PR #51 で、TLS は残り 14 日未満 sev3（予兆）→ 7 日未満 sev2 → 失効後は MON-001 が sev1、DNS は sev1（RT-SEV1）に統一し、`monitors.yaml`・`alert-routes.yaml`（`threshold_escalation`）・README を一致させた。両方とも無効で、運用には影響しない。

## monitoring-05 認証・Test account・Data

**結論**: **認証付き監視は無い**（認証なしの 1 人用アプリ）。したがって資格情報・専用アカウント・アカウントの期限管理は**存在しない**。承認済みの対象外として扱う（EXC-004）が、**書込みを伴う監視の専用データと後始末、個人情報の扱いは実施している**。

**認証方式**: `auth.method: none`、`inline_credentials: false`（全 13 件）。`check-config.mjs` が「資格情報の直書きは false でなければならない」を検査する。リポジトリに監視用の秘密情報は無い（`synthetic.yml` が使うのは Actions が発行する `GITHUB_TOKEN` だけで、GHCR の `packages: read`、alert ジョブの `issues: write` に限定）。

**専用アカウント**: 無い（認証が無いため）。代わりに**専用のデータ**を使う。タイトルは `synthetic-<run_id>-<monitor_id>`（機械生成）で、利用者のタスクと区別できる。

**後始末（cleanup）**: 書込みを伴う監視は 6 件（MON-003・004・005・007・008・009）。API ジャーニーは作った `task_id` を**成否にかかわらず** DELETE（404 は削除済みとして許容）し、後始末の失敗も失敗として報告する。ブラウザジャーニーは UI で削除し、`afterEach` で接頭辞 `synthetic-<run_id>` のタスクを API からも全部消す。不正入力の監視（MON-006・010）は作らない設計で、万一保存されたら件数差で検知して失敗にする（実データを誤って消さないため自動削除はしない）。単体テストで「削除が効かない実装を検知し、後始末でも失敗を報告する」ことを確認している（`scripts/monitoring/test/monitoring.test.mjs`）。

**個人情報（PII）方針**: 個人情報を使わない合成データのみ（全監視の既定。`monitors.yaml` の `pii_policy`）。実在の個人・秘密情報は入れない。監視が見るのは、実行用に起動した compose の中のデータで、**実利用者のデータには触れない**（本番が無い）。

**資格情報の運用（監査可能か）**: 管理すべき資格情報が無いため、期限・ローテーション・保管場所の記録は**不要**で、無い。「資格情報の運用が監査可能」という満点の状態は、対象が無く**示せない**。

**承認済みの対象外**: [docs/ai-context.yaml](ai-context.yaml) の `EXC-004`（`criterion_id: monitoring-05`。承認者: プロダクトオーナー。承認の根拠: 本ファイルを含む PR のマージ。フェーズ1は AI が代行マージ。承認日 2026-10-12、見直し日 2027-01-12、見直しの契機: 認証を導入したとき）と、[01 テスト計画書](01-test-plan.md)の plan-03。**承認が確定するのは、これらを含む PR がマージされた時点**で、マージ前は提案である。plan-03 の見直し日は 2027-01-12 で、`ai-context.yaml` の EXC-004 の見直し日（`review_by`）も 2027-01-12 に揃えた（以前は 2027-04-12 で食い違っていた。`expires_at` は承認の有効期限、`review_by` は見直し日で、意味が違う）。認証を導入したら、資格情報の保管（シークレット）・専用アカウント・アカウント単位の後始末を設計してから監視を足す。

## monitoring-06 Schedule・Timeout・Retry

**結論**: 実行間隔は **1800 秒（30 分）**。既定の上限 300 秒（5 分）は**満たしていない**。timeout と retry は監視の種類に応じて決め、誤報を抑えている。理由と限界は以下のとおり。

| 項目 | 値 | 理由・根拠 |
|---|---|---|
| **interval（実行間隔）** | 1800 秒（`synthetic.yml` の cron `7,37 * * * *`）。MON-011 は 86400 秒、MON-012 は 3600 秒（いずれも無効） | GitHub Actions の schedule は最短 5 分で、起動のたびに compose の起動と Playwright の導入に 1〜2 分かかり、cron は遅延・欠落しうる。5 分にしても実際の間隔は保証できないため、30 分にした（[monitoring/README.md](../monitoring/README.md)「実行間隔と検知時間」） |
| **timeout（1 試行）** | http 10 秒、api 20 秒、browser 60 秒 | 通常の応答は数 ms〜数十 ms（http・api）・約 0.9〜2.5 秒（browser。`monitoring/history/` と run 38140285304 の `results.json`）。余裕を持たせつつ、間隔（1800 秒）より十分短い |
| **retry（最初の失敗の後の追加回数）** | MON-001・002 が 2、そのほかが 1 | 一過性の失敗で鳴らさない。最悪でも `timeout × (retry + 1)` + 待機 5 秒で結果が出る（例: MON-007 は 60 秒 × 2 + 5 秒 ≈ 2 分、MON-002 は 10 秒 × 3 + 数秒 ≈ 40 秒）。E2E は retry で flaky を隠さない方針（Playwright `retries: 0`）だが、**外形監視は retry を定義の一部として持ち（`run-monitors.mjs` が実行）、`attempts` と失敗詳細を記録する**（Playwright 側の retry は 0 で、再試行は監視側に一本化） |
| **多地点** | 1 か所 | monitoring-03 を参照。`locations: 1` |

**検知時間（MTTD）**: 目標は「**30 分 + retry 時間**」。障害が起きた直後に実行が終わっていれば次の実行（最大 30 分後 + cron の遅延）で検知する。cron の遅延は保証しない。実測では、検知 → 通知は 17〜37 秒（通知試験 17・20 秒、本物の #36 は 37 秒。monitoring-07・12）。**ただし schedule の実行の間隔が、cron の 30 分でなく 3 時間 24 分〜6 時間 41 分だった**（2026-10-11 18:01・21:52、10-12 01:16・07:57 UTC の 4 回。いずれも `event=schedule`）。**この実績では、MTTD は「30 分 + retry」ではなく最大 7 時間近くになり、目標を満たしていない**。GitHub の schedule は遅延・欠落しうると定義時から書いていたが、実績で裏付けられた。死活監視（3 時間しきい値）が、最終実行から 5.3 時間空いた 2026-10-12 06:35 UTC に #59 を起票した（monitoring-07）。

**誤報との両立**: 1 回の失敗では鳴らさず、retry で再試行してから失敗とする。リリース直後 15 分（SUP-001）と計画停止は通知を抑える（monitoring-09）。実際に鳴った 1 件（#36）は誤検知で、retry（2 回試行）では防げなかった（監視の定義が古く、再試行しても毎回失敗するため）。誤検知の原因は閾値ではなく**定義の鮮度**だった（monitoring-12）。

**文書化と見直し**: 基準は [monitoring/README.md](../monitoring/README.md) と本書に書いた。見直しは `fp-fn-log.md` の運用ルール（月 1 回またはリリースごと）で行う。**月次の見直しはまだ 1 度も実施していない**（運用開始が 2026-10-11 で 1 か月に満たない）。

**可用性 SLO との整合**: `availability_synthetic_ratio` は「障害の継続時間」ではなく「30 分ごとの実行の成功率」で定義している。30 日で約 1,440 回の実行（30 分間隔なら 48 回/日 × 30）があり、99% は失敗 14 回以下に当たる。**実績の schedule 間隔が 3〜7 時間だと、30 日の実行は 100〜200 回程度**で、定義の前提が崩れる。**30 分未満の短い障害は観測できない**（実行の間に起きて回復すれば見逃す。実績の間隔では数時間の障害も見逃しうる）。短い障害の検知（再起動復帰）は TC-042・TC-043・TC-077 が担当し、外形監視は「ある時点でジャーニーが通るか」を保証する。

## monitoring-07 Alert routing・Owner

**結論**: severity 3 段階、通知先（GitHub Issue のラベル `incident`）、on-call（ロール maintainer）、acknowledgement の方針を定義し、**13 件すべての監視に通知経路がある**（`alert-routes.yaml`。`check-config.mjs` が検査）。通知の到達は**実際に動いた記録がある**が、**人が受け取ったことは観測できない**。

**severity**:

| severity | 意味 | 監視 | 経路 | ack の目標 | リマインド |
|---|---|---|---|---|---|
| sev1 | 画面または backend が使えない（全利用者に影響） | MON-001・002・013（と、無効の MON-012 DNS） | RT-SEV1 | 検知から 24 時間 | 12 時間 |
| sev2 | 主要な操作が壊れている。画面は開くが使えない機能がある | MON-003〜010 | RT-SEV2 | 24 時間 | 24 時間 |
| sev3 | 性能劣化のみ、証明書の期限の予兆（残り 14 日未満。有効化後）、**監視の実行基盤の失敗・停止（MON-META）** | MON-011（無効）、MON-META | RT-SEV3 | 72 時間 | 72 時間 |

MON-META は監視（monitor）ではなく、実行基盤の失敗・停止を表す incident の識別子（`synthetic.yml` の `meta-alert` ジョブと `monitoring-watchdog.yml` が `[sev3][MON-META]` で起票。RB-005）。監視は 13 件（有効 11・無効 2）のまま変わらない。

**通知先（channel）**: `github-issue:incident`。タイトルは `[{severity}][{monitor_id}] {name} が失敗`。同じ `monitor_id` の open な incident があれば新規作成せずコメントを追記し（重複排除）、回復したらコメントして close する。メール・チャット・電話などの外部通知は**持たない**（個人用アプリ。plan で単一の連絡経路を残存リスクとして受容）。

**on-call**: ロール `maintainer`（`.github/CODEOWNERS` の既定の所有者）。Issue の assignee は実行時に CODEOWNERS から解決する。**ローテーションは無く、メンテナ 1 名**（`alert-routes.yaml`）。時間帯は best-effort（24 時間 365 日の対応は約束しない）。**不在時の代理は置けない**（単独のリポジトリオーナーと AI エージェントでの運用。ロールは兼務）。

**acknowledgement（ack）**: 次のいずれかを ack とする — Issue へのコメント（自動投稿者以外）、ラベル `ack` の付与、assignee（メンテナ）が Issue を確認した記録。**エスカレーション**: 12 時間で未 ack なら Issue にリマインドのコメントとラベル `escalated`、24 時間でラベル `ack-overdue`。**メンテナ以外の連絡先が無いため、これ以上の経路は無い**（単一メンテナの残存リスク）。

**到達と ack の記録（実績）**:

| 日時（UTC） | 種別 | 検知 → 通知 | ack | 回復 | 記録 |
|---|---|---|---|---|---|
| 2026-10-11 07:21 | 通知試験（手元） | 20 秒 | 13 秒（assignee の確認） | 約 38 秒 | #13・#14（close 済み） |
| 2026-10-11 07:26 | 通知試験（手元） | 17 秒 | 10 秒（assignee の確認） | 約 31 秒 | #17・#18（close 済み）、`monitoring/drills/20261011T0726Z-notification/` |
| 2026-10-11 16:14 | 通知試験（**GitHub Actions**。v1.0.0 のイメージを digest 固定で起動。run 38154528493） | 31 秒 | 4 秒（assignee の確認） | —（**fail**。失敗フェーズの直後に回復フェーズを呼ぶと、作成直後の #45 が Issue 一覧〔検索の索引〕に載らず回復できなかった） | #44（close 済み）・#45（取り残し → 手動で close）、`monitoring/drills/20261011T1614Z-gha-drill-fail-index-lag/` |
| 2026-10-11 16:21 | 通知試験（GitHub Actions。修正後。run 38155028980） | 36 秒 | 5 秒（assignee の確認） | 8 秒 | #48・#49（close 済み）、`monitoring/drills/20261011T1621Z-gha-drill-pass/`。**pass** |
| 2026-10-11 16:2x | 実行基盤の失敗の通知試験（`meta_drill=true`。run 38155036726） | `meta-alert` が `[drill][sev3][MON-META]` を起票 | — | すぐ close | #50（close 済み）。`alert` ジョブは skipped（監視の失敗と区別される）。**pass** |
| 2026-10-12 06:36 | **本物（GitHub Actions。死活監視 `monitoring-watchdog.yml`）** | 約 18 秒（watchdog の実行 06:35:42Z → Issue 作成 06:36:00Z） | assignee の設定のみ（人のコメントは無い。ack 目標は 72 時間） | 約 84 分（08:00:25Z に schedule の `synthetic.yml` が成功して自動 close） | #59（`[sev3][MON-META] 外形監視が 3 時間以上実行されていない`。失敗の詳細: 最終実行が 5.3 時間前〔2026-10-12T01:16:32Z〕）、run 38213286831・38220637289 |
| 2026-10-11 12:43 | **本物（GitHub Actions）** | 約 37 秒（失敗の開始 12:43:35 → Issue 作成 12:44:12） | assignee（メンテナ）のアカウントのコメントが 15:57（起票から約 3 時間 13 分、24 時間目標以内。**目的は ack ではなく defect 本文の補筆**。投稿者が人か AI かは区別できない） | 約 12 分（12:56:26 に自動 close） | #36、run 38140285304・38141090678 |

- 試験の ack は **assignee が設定されていることの確認**までで、**人が通知を受け取ったかは観測できない**（`alert-routes.yaml` の `delivery_note`、`monitoring/README.md`）。GitHub が assignee へメール・Web 通知を送るが、到達は観測外。したがって「通知の到達と ack が記録されている」を満点どおりには満たさない。
- **GitHub Actions 上の通知試験（`drill: true`）は 2026-10-11 に 3 回実施した**（初回は fail → 修正 → pass。ほかに実行基盤の失敗の試験が 1 回。上の表）。初回の fail は、GitHub 上の drill でしか見つからない不具合（回復フェーズが一覧の索引の遅れで取りこぼす）を見つけ、PR #51 で `drill-state.json` の既知の Issue を使うよう直した（単体テストあり）。#36 の本物の失敗も、Actions の経路（失敗 → 起票 → assignee → 回復 → close）を実際に通した（`alert-tests.md`、PR #39）。通知試験は手元 2 回 + Actions 3 回の計 5 回で、すべて 2026-10-11（同じ日）。**#59 は、MON-META の通知が通知試験でなく本物の停止で動いた最初の記録**（死活監視 → incident → 次の実行で自動回復）。ただし #59 の本文は起票時のままで、切り分け・ロールバック有無・還流のチェックリストは空欄・未チェック（RB-005 に沿った対応記録は無い。schedule の遅延は GitHub 側の事象で、こちらの修正で直るものではない）。
- 本物の #36 では、起票時の本文（概要・対応・還流先チェックリスト）を後で欠陥票の書式に**書き換えた**ため、現行の本文には還流のチェックリストなどが残っていなかった。**PR #51 で、起票時の本文を編集履歴から復元し、defect の項目を `---` の後ろに追記した形に戻した**（現行の本文に、概要・直前のデプロイ〔deployment_ref〕・失敗の詳細・対応〔ack 目標〕・再発防止チェックリストがあることを 2026-10-12 に確認した）。incident と defect を同じ Issue で兼ねるときは、本文を上書きせず追記する規則を `monitoring/README.md` と `incident.md` テンプレートに書いた（monitoring-14）。

## monitoring-08 Runbook・Escalation

**結論**: runbook は **5 本**（RB-001〜RB-005。[monitoring/runbooks/](../monitoring/runbooks/index.yaml)）。いずれも **一次対応・切り分け・rollback・連絡経路**の 4 節と**訓練記録**の節を持ち、`check-config.mjs` が節の有無を機械で確かめる（宣言と食い違えば失敗）。ジャーニーを持つ有効な監視 10 件はすべていずれかの runbook に対応する（網羅 100%）。incident Issue の本文に runbook へのリンクが自動で入る。

| runbook | 対象の監視 | 一次対応・切り分け・rollback・連絡経路 | 訓練 |
|---|---|---|---|
| RB-001 frontend 配信 | MON-001 | あり（4 節） | 2026-10-11 07:29 UTC に frontend 停止 → 復旧（約 13 秒）。失敗詳細の読み方を確認 |
| RB-002 backend health | MON-002・013 | あり（4 節。rollback は前リリースの digest 固定・DB バックアップ・スキーマの前方移行の注意まで） | 2026-10-11 07:25 に rollback 訓練（検知から完了まで 16 秒）、12:20 に #16 の修正後に再実施（16 秒）、07:27 に backend 停止 → 復旧（31 秒） |
| RB-003 API ジャーニー | MON-003〜006 | あり（4 節） | 切り分け表の個別行は**未訓練**（契約違反などを意図的に作っていない） |
| RB-004 ブラウザジャーニー | MON-007〜010 | あり（4 節） | locator 変更の切り分けは**未訓練**。#36 の再発防止の行（`Clicking the checkbox did not change its state`）を追加した |
| RB-005 監視基盤 | （監視の対象外。監視自体の障害。MON-META） | あり（4 節。MON-META の一次対応・切り分け・残存リスクを PR #51 で追記） | 実行基盤の失敗の通知試験（`meta_drill=true`）を 2026-10-11 16:2x に実施して pass（run 38155036726、#50）。**cron の欠落・イメージ取得失敗・Playwright の導入失敗は未訓練**。死活監視（`monitoring-watchdog.yml`）は 2026-10-12 06:35 UTC に実際に MON-META（#59）を起票して動いたが、訓練ではなく実発生で、RB-005 に沿った切り分けの記録は無い |

- **一次対応**: incident Issue の失敗詳細を読む → 状態を確認（`docker compose ps`・ログ・health）→ 再起動 → Issue にコメント（ack）→ 回復の確認。目標は 15 分以内に「止まっているか・遅いか・壊れているか」を判別すること（RB-002）。
- **切り分け**: 症状（失敗詳細）→ 疑う場所 → 確認コマンド → 対処の表（RB-002 は 7 行）。
- **rollback**: 前のリリースの digest を引き、`rollback.yml`（上書きファイル）で入れ替え、health の version / commit と監視で確認する。DB のスキーマ移行が前方のみの場合は、バックアップから復元せずメンテナに連絡する。
- **連絡経路**: 一次は GitHub Issue（ラベル `incident`）。**外部の連絡先は無い**（単一メンテナの残存リスク）。
- **訓練での検証**: 訓練（rollback 2 回、停止 → 復旧 2 回、frontend 停止 1 回）は `monitoring/drills/` に生の記録（時刻・結果・health の版）がある。**訓練の限界**: rollback 訓練の前のイメージは**ローカルでタグ固定したもの**で、GHCR の digest での rollback は未検証。ただし v1.0.0 の公開後（2026-10-11 15:46:54 UTC）の Actions 上の通知試験（run 38154528493・38155028980）で、`resolve-target` が最新リリース v1.0.0 の digest（backend `sha256:87addb2e…`、frontend `sha256:c82e88ba…`）を引き、digest 固定で pull して起動できることは確認できた（`monitoring/drills/*/target.json` が `mode: release`）。**未検証**: `rollback.yml` で前のリリースの digest へ戻す訓練（v1.0.0 より前のリリースが無いため、前の digest が無い）、DB スキーマ移行が前方のみの場合の戻し。
- 満点の「runbook が訓練で検証されている」は、RB-001・002 では満たし、RB-005 は一部（MON-META の通知試験と、#59 の実発生での起票）だけ。**RB-003・RB-004 は未訓練**で、全体としては満たしていない。

## monitoring-09 Maintenance・Change handling

**結論**: 計画停止の窓の仕組み（`maintenance_windows`）と、リリース直後の抑制ルール（SUP-001）を持つ。**feature flag は本アプリに無い**。誤報率は**まだ計測できていない**（実績が足りない）。

| 項目 | 状態 | 根拠 |
|---|---|---|
| **計画停止（maintenance window）** | 仕組みあり。**登録済みの窓は 0 件** | `maintenance.yaml` の `maintenance_windows: []`。停止の前に PR で追記する（レビュー経由）。窓の中の失敗は通知しない。窓が過ぎた行は履歴として残す。単体テストで確認（「計画停止の窓の中は抑制する」） |
| **リリース（SUP-001）** | あり | リリース直後 15 分は失敗を通知しない。起点は、デプロイマーカーが記録した最新リリースの公開時刻、または health の version / commit が前回の実行から変わった直後。15 分を過ぎても失敗が続けば通知する。単体テストで確認（「リリース直後 15 分は抑制し、過ぎたら抑制しない」）。**実運用では未発動**（通常の 2 回の実行はリリース公開前で `release_tag` は null。Actions 上の通知試験 2 回は v1.0.0 公開〔15:46:54Z〕の約 27 分後・34 分後で、SUP-001 の 15 分の外。通知試験は抑制を評価しない） |
| **feature flag** | 無い | `maintenance.yaml` の `feature_flags.exists: false`。導入したら、切替をデプロイマーカーと同様に記録し、切替直後を SUP に加える |
| **抑制の透明性** | 抑制した失敗も隠さない | run history に `result: fail`・`alert_suppressed: true`・`suppression_reason` 付きで残す |
| **通知試験（drill）** | 抑制ではなく分離 | drill ラベル付きの Issue に分け、本物の incident と混ざらない（drill のフェーズでは抑制を評価しない） |
| **保守中に発報した件数** | 0 件（アラート履歴のうち保守中のもの） | 窓が未登録のため。計測できる状態ではない |

- **誤報率**: 誤報（誤検知）は #36 の 1 件。監視（MON-001〜013）が通知した本物の incident は 1 件なので誤検知率は 1/1 に見えるが、**母数が 1 で、傾向としての意味は無い**（monitoring-12）。#59（MON-META）は誤報ではなく、実際の schedule の空白を捉えた通知。見直しの規則（20% を超えたら見直す）は `fp-fn-log.md` にあり、#36 では定義を直した。
- できていないこと: 実際の計画停止での窓の運用、リリース時の SUP-001 の発動、feature flag を持ったときの扱い。

## monitoring-10 Monitoring as Code・Version

**結論**: 監視の定義・経路・抑制・対象・runbook・実行スクリプト・ブラウザジャーニー・ワークフローのすべてが Git のファイルで、**13 件すべてが `defined_in: monitoring/monitors.yaml` を持つ**。変更は PR を通り、`git revert` で戻せる。**ただし PR のレビューを GitHub が強制してはいない**（Ruleset 未適用）。

| 管理対象 | 場所 |
|---|---|
| 監視の定義（正本） | `monitoring/monitors.yaml` |
| 通知経路・severity・on-call・ack | `monitoring/alert-routes.yaml` |
| 計画停止・リリース抑制・feature flag | `monitoring/maintenance.yaml` |
| 監視対象のイメージ | `monitoring/target.yaml` |
| runbook と索引 | `monitoring/runbooks/` |
| ブラウザジャーニー | `e2e/synthetic/journey.spec.js` |
| 実行・通知・マーカー・検査・死活監視 | `scripts/monitoring/`（単体テスト 34 件） |
| 起動 | `.github/workflows/synthetic.yml`（30 分ごと + 手動）、`.github/workflows/monitoring-watchdog.yml`（死活監視。3 時間ごと） |

**レビュー**: `.github/CODEOWNERS` の `*` がプロダクトオーナー兼メンテナ。変更の手順は `monitoring/README.md` の「変更の手順」（PR → `check-config` と単体テスト → 製品の振る舞いを変える PR は監視の期待も同じ PR で確認）。**ただし、`main` への PR 必須・承認・required checks を強制する Ruleset は未適用**（`ai-context.yaml` の `repository.expected_controls`。`gh api repos/bsj-fujimoto/todo-app/rulesets` が 0 件）。実態としては、監視の変更はすべて PR（#32、#39、#51）でマージされたが、レビューは単独のリポジトリオーナー（AI の代行マージを含む）によるもので、**独立した第二のレビュアーはいない**。

**rollback**: 設定・スクリプトの不具合は `git revert <commit>` の PR で取り消す（履歴を書き換えない。RB-005）。**設定の revert は訓練していない**。

**変更履歴と監視の変更の対応**: `monitoring/` 配下を触ったコミットは 3 つ — `ffc2cdc`（PR #32、2026-10-11。監視の導入）、`5fcf40a`（PR #39。MON-008 の誤検知の修正）、`5263ff6`（PR #51、2026-10-12 01:30 JST。MON-007 の応答時間、MON-META・死活監視、重大度の整理、drill で見つけた不具合の修正）。**PR #39 は、incident #36 と `fp-fn-log.md` の行に結び付く**（誤検知・見逃しに起因する変更は PR 番号とともに `fp-fn-log.md` に記録する規則）。PR #51 の変更の一部（GitHub 上の drill で見つけた不具合）は `alert-tests.md` に記録した。変更履歴が短い（3 件）ので、規則が長期に守られるかは未検証。

**検査**: `check-config.mjs` が、必須項目、`slo_ref` が `perf/slo.yaml` に実在すること、全監視に通知経路があること、重要ジャーニーが http / api / browser で守られていること、runbook が重要監視を覆い 4 節を持つこと、無効な監視に理由があることを検査する。2026-10-12 に手元で `[check-config] OK`、単体テスト 34 件 pass を確認した。**PR #51 から、これらは `synthetic.yml` の最初のステップに加えて、PR の CI（`ci.yml` の lint ジョブ）でも動く**（設定を壊した PR は main に入らない）。また、実行基盤が結果を出す前に失敗したときは `meta-alert` が `[sev3][MON-META]` を起票し、`synthetic.yml` が 3 時間以上動いていなければ `monitoring-watchdog.yml` が起票する（以前の「設定を壊した PR が main に入ると incident Issue が作られない」弱点への対策。いずれも PR #51）。**残る限界**: 死活監視も GitHub の schedule で動くので、schedule が止まれば一緒に止まる（同じ基盤の死活は同じ基盤では監視できない。`monitoring/README.md`・RB-005）。死活監視は 2 回動き、2 回目に実際に MON-META（#59）を起票した。

## monitoring-11 実行履歴・証拠

**結論**: 履歴の**形式**（成功・失敗、失敗の詳細、対象 version、attempts、抑制の有無、地域）と**保存**（Actions の artifact 90 日、Git に保存例）は揃っているが、**期間が短く（schedule の最初の実行から約 14 時間）、schedule 実行は 4 回だけで、間隔も定義の 30 分でない**。成功率の評価も、履歴からのインシデント分析も、現時点では十分にはできない。

**実行履歴**:

| 場所 | 内容 | 件数 |
|---|---|---|
| GitHub Actions（`gh run list --workflow synthetic.yml`）の通常実行 | 2026-10-11 12:42 UTC（run 38140285304、手動、**失敗**＝#36 の誤検知）と 12:54 UTC（run 38141090678、手動、成功）。どちらも対象は「フォールバック（main の HEAD）」 | 2 run（監視記録 22 件。有効 11 件 × 2） |
| 同・通知試験（`drill: true`）と基盤試験（`meta_drill: true`） | 16:13 UTC（run 38154528493、**失敗**＝回復の取りこぼしを見つけた）、16:20 UTC（run 38155028980、成功）、16:20 UTC（run 38155036726、基盤試験。意図的に失敗させて `meta-alert` を確認）。前 2 つは v1.0.0 のイメージを digest 固定で起動 | 3 run。**`synthetic.yml` の Actions 上の実行は、ここまでで手動 5 回** |
| GitHub Actions の schedule 実行（`gh api repos/bsj-fujimoto/todo-app/actions/runs?event=schedule`。2026-10-12 17:00 JST〔08:00 UTC〕時点で total_count = 8） | `synthetic.yml` が **4 回**: 2026-10-11 18:01:35Z（run 38162078317）、21:52:01Z（38178114415。MON-003 が 2 試行目で成功）、2026-10-12 01:16:32Z（38191254696）、07:57:03Z（38220637289）。**すべて対象は v1.0.0（release モード、digest 固定）、成功、監視 11/11（有効 11 件 × 4 = 記録 44 件）**。間隔は 3 時間 50 分・3 時間 24 分・6 時間 41 分（cron は 30 分ごと）。`monitoring-watchdog.yml` が 2 回（22:29:56Z〔run 38180651666〕、06:35:42Z〔38213286831。#59 を起票〕）、nightly が 2 回 | `synthetic.yml` 4 + watchdog 2 + nightly 2 = 8 |
| Git に保存した手元の実行（`monitoring/history/`、`monitoring/drills/`） | 通常実行 1 回（2026-10-11 07:20 UTC）と、通知試験・rollback 訓練・frontend 停止訓練・Actions の drill の記録（`run-history.jsonl` は 15 ファイルで計 97 行） | 97 行 |

- **成功率**: 通常の実行（手動 2 回 + schedule 4 回）で成功 5・失敗 1（失敗は #36 の誤検知）。通知試験・基盤試験の 3 回は意図的に失敗させたものを含み、成功率に数えない。**標本が 6（schedule は 4）で、成功率（`availability_synthetic_ratio` ≥ 0.99）としての意味は無い**。`history_retention_days` は 90（artifact の保持）だが、実際の履歴は約 1 日。本来は 30 日の約 1,440 回が必要で、実績の間隔（3〜7 時間）では 100〜200 回にしかならない。
- **schedule の経緯と間隔**: `synthetic.yml` は 2026-10-11 12:36 UTC（PR #32 のマージ）から main にあり、cron は `7,37 * * * *`。最初の schedule 実行は **5 時間 25 分後の 18:01 UTC**（それまでは 0 件。新しい workflow の schedule は初回が遅れることがある、という GitHub の挙動と整合する）。**その後も、30 分ごとではなく 3〜7 時間に 1 回程度**しか起動していない（原因は GitHub 側の schedule の遅延・欠落と見られるが、**GitHub に確認していない。未特定**）。`monitoring-watchdog.yml`（cron `47 */3 * * *`）は PR #51 のマージ（16:30 UTC）後、22:29 UTC と 06:35 UTC の 2 回だけ起動した（3 時間ごとの定義なら 5 回ほど起動するはずで、これも遅延・欠落している）。**次の確認**: `event=schedule` の件数と間隔を再確認し、定義（30 分）と実績の差が続くなら、`synthetic.yml` の間隔の定義か、schedule に頼らない手段（常駐の外部監視。本番を持つなら必須）を決める。RB-005 の「実行が来ない」の手順（有効化・default branch・無活動 60 日の無効化）は該当しない（リポジトリに活動がある）。
- **失敗内容**: `run-history.jsonl` の `failure_detail` に試行ごとの失敗の内容を記録し、browser は失敗時の screenshot と trace を artifact に残す設定（`retain-on-failure`）。失敗した run 38140285304 の履歴は、試行 2 回とも `locator.check: Clicking the checkbox did not change its state` を記録している。失敗 1 件のうち詳細ありは 1 件（100%）。
- **対象 version**: 各記録に `version`（例 `1.0.0@2c357a6`）、`mode`（release / fallback）、`region`、`run_id` を持つ。version は health の `version@commit` で、記録の 100% に入っている。
- **alert 履歴**: `alert-history.jsonl`（`kind: created / recovered`、severity、Issue 番号、drill かどうか）と incident Issue 自体（GitHub。ラベル `incident` の Issue は #13・#14・#17・#18・#36・#44・#45・#48・#49・#50・#59 の 11 件。本物は #36〔誤検知〕と #59〔MON-META〕の 2 件、残り 9 件は drill）。ただし**通知の到達と人の ack は記録できない**（monitoring-07）。
- **インシデント分析**: #36 は、Issue 本文の失敗詳細・対象版・run の URL・artifact から原因（監視の定義が古い）まで追えた。#59 は、本文の失敗詳細（最終実行 5.3 時間前）と run から、schedule の空白と分かった。分析の母数が 2 件で、傾向分析（時間帯・リリースとの相関・MTTR の分布）は**できない**。

## monitoring-12 誤検知・見逃し・Alert test

**結論**: **誤検知 1 件**を台帳に記録して原因分類と対応（PR・再発防止）まで行い、**通知試験は手元 2 回 + GitHub Actions 3 回の計 5 回**（2026-10-11。手元 2 回は pass、Actions は 1 回 fail〔不具合を見つけた〕→ 修正 → pass と、実行基盤の失敗の試験 1 回 pass）実施した。見逃しは 0 件記録だが、**見逃しの発見源（実利用者）が無い**。通知試験は 90 日以内（次回 2027-01-09）の周期にしてある。

**通知試験（alert test）**: 台帳は [monitoring/alert-tests.md](../monitoring/alert-tests.md)。意図的な障害注入（backend コンテナの停止）→ 失敗検知 → incident Issue 作成（labels `incident` + `drill`、assignee 確認）→ 復旧 → 回復コメント → 自動 close を確かめる。

| 日時（UTC） | 実施方法 | 検知 → 通知 | ack | 回復 | 結果 |
|---|---|---|---|---|---|
| 2026-10-11 07:21 | 手元（`drill.sh`） | 20 秒 | 13 秒 | 約 38 秒 | pass。この実施で不備（失敗詳細の重複・影響欄が空・版が不明）を見つけ、修正して再実施 |
| 2026-10-11 07:26 | 手元（`drill.sh`） | 17 秒 | 10 秒 | 約 31 秒 | pass（#17・#18） |
| 2026-10-11 16:14 | GitHub Actions（`synthetic.yml` drill=true、v1.0.0 のイメージを digest 固定。run 38154528493） | 31 秒 | 4 秒 | —（回復を取りこぼした） | **fail**（#44・#45）。GitHub 上の drill でしか見つからない不具合（作成直後の Issue が一覧の索引に載らず、回復フェーズが閉じられない）。PR #51 で修正（単体テストあり） |
| 2026-10-11 16:21 | GitHub Actions（同、修正後。run 38155028980） | 36 秒 | 5 秒 | 8 秒 | pass（#48・#49） |
| 2026-10-11 16:2x | GitHub Actions（`meta_drill=true`。実行基盤の失敗の試験。run 38155036726） | — | — | — | pass（#50）。`[drill][sev3][MON-META]` を起票して close、`alert` ジョブは skipped |

- 確認項目（すべて OK）: Issue 作成、ラベル、assignee、復旧の検知、回復コメントの後の close。
- **できていないこと**: 5 回とも同じ日（2026-10-11）で、**「定期的」な試験の実績ではない**。周期は 90 日に 1 回（次回 2027-01-09 まで）と定め、`synthetic.yml` の手動実行（`drill: true`）で行う。死活監視（`monitoring-watchdog.yml`）の起票の試験も未実施。

**誤検知・見逃しの台帳**: [monitoring/fp-fn-log.md](../monitoring/fp-fn-log.md)。種別（FP / FN）、原因の分類、対応（PR・Issue）を 1 行ずつ記録する。

| 日付（UTC） | 種別 | 監視 | 原因・分類 | 対応 |
|---|---|---|---|---|
| 2026-10-11 12:43 | **FP（誤検知）** | MON-008（J-02 完了切替、browser） | 監視の定義が古い。PR #12 で製品は「チェックは API 成功後にだけ反転する」に直った（設計どおり）が、監視の Playwright `check()` はクリック直後に状態変化を検証するため合わなくなった。製品の不具合ではない | `click()` + `expect(...).toBeChecked()` に変更（PR #39）、PR テンプレート・`monitoring/README.md`・RB-004 に還流（Issue #36） |

- 見逃し（FN）の記録は 0 件。**実利用者が居ないため、見逃しを発見する源が無い**（`fp-fn-log.md` の「現状の注記」）。見逃しの発見は通知試験と手動の障害注入に限られる。
- **訓練・試験で見つけた不備**（誤検知の芽）: リリース済みイメージを `COMMIT_SHA` 未指定で起動すると health の commit が `unknown` になり、MON-002 の commit 一致が不一致になる（実環境では誤報になる）。rollback 訓練で見つけ（#16）、PR #19 で compose の設定を直した。直した後に rollback 訓練を再実施して pass（`monitoring/drills/20261011T1220Z-rollback-after-16fix/`）。GitHub 上の通知試験（run 38154528493）は、回復フェーズが Issue 一覧の索引の遅れで取りこぼす不具合を見つけ、PR #51 で直して再実施した（pass）。
- **誤検知率**: 運用の規則は「直近 30 日の通知回数のうち問題なしだった割合。20% を超えたら retry・timeout・assertion を見直す」。**現在の値は、監視（MON-001〜013）の本物の通知 1 件（#36）のうち誤検知 1 件で 1 / 1 = 100%**で、規則の閾値を超えるが、母数が 1 件で統計的な意味は無い。閾値は超えたので見直した（#36 の定義修正）。基盤（MON-META）の本物の通知 #59 は、実際の schedule の空白を捉えた正しい通知で、誤検知に数えない。drill の通知（9 件: #13・#14・#17・#18・#44・#45・#48・#49・#50）は母数に含めない。月次の集計表は**まだ空**（運用が 1 か月に満たない）。
- 満点の「誤検知率が改善に使われている」に対して、**改善に使った実例は 1 件**（#36 → 定義の修正と PR テンプレート）。率の推移は無い。

## monitoring-13 Release correlation

**結論**: デプロイマーカー（health の version / commit と GitHub Release のタグ・公開時刻）を実行のたびに記録し、incident Issue の本文に直前のデプロイを自動で書く（`deployment_ref`）。**インシデントとリリースを関連付ける仕組みは動いた**が、**リリースと異常の相関を定期的に分析した実績は無い**。

**デプロイマーカー**: `scripts/monitoring/marker.mjs` が、health の `version`・`commit`・`status` と、最新 GitHub Release の `release_tag`・`release_published_at`・`matches_latest_release` を `deployment-markers.jsonl` に 1 行追記する。MON-002 の assertions が、health の version / commit が期待値（最新リリース、またはフォールバック時は checkout の commit）と一致することを毎回確かめる。リリース v1.0.0 は 2026-10-11 15:46:54 UTC に公開（commit 5fcf40a、`release.yml` の run 38152472087）。

| マーカー | 時刻（UTC） | version / commit | release_tag |
|---|---|---|---|
| 手元の通常実行 | 2026-10-11 07:20 | 1.0.0 / 552a854 | なし（リリース前） |
| Actions run 38140285304 | 2026-10-11 12:43 | 1.0.0 / 2c357a6（フォールバック） | なし |
| Actions run 38141090678 | 2026-10-11 12:55 | 1.0.0 / 65721736（フォールバック） | なし |
| Actions run 38154528493（通知試験） | 2026-10-11 16:14 | 1.0.0 / 5fcf40a（release。digest 固定） | v1.0.0（公開 15:46:54Z。`matches_latest_release: true`） |
| Actions run 38155028980（通知試験） | 2026-10-11 16:21 | 1.0.0 / 5fcf40a（release。digest 固定） | v1.0.0（`matches_latest_release: true`） |
| Actions の schedule 4 回（run 38162078317・38178114415・38191254696・38220637289） | 2026-10-11 18:01〜2026-10-12 07:57（UTC） | 1.0.0 / 5fcf40a（release。digest 固定。version は変わらず、`version_changed_at` は null） | v1.0.0（`matches_latest_release: true`） |

**異常開始時刻との関連付け**: incident Issue の本文に直前のデプロイ（`version`・`commit`・観測時刻）を自動で入れる。#36 の起票時の本文には「直前のデプロイ（deployment_ref）: version 1.0.0、commit 2c357a6df29924294c6df29829a2aa697572a6e2（観測 2026-10-11T12:43:32.490Z）」と入っていた（Issue の編集履歴で確認。現行の本文は欠陥票の書式に書き換えたため残っていない）。rollback 訓練では、悪いリリースを入れた直後に commit の不一致を検知し、16 秒で前の版へ戻した（`drills/20261011T0725Z-rollback/`）。

**#36 から分かった、マーカーによる相関の限界**: #36 の異常（MON-008 の失敗）は、**監視が初めて動いた時刻（12:43）から**始まったように見えたが、原因は **5 時間以上前の PR #12 のマージ（07:08 UTC）**で、直前のデプロイ（2c357a6）ではなかった。マーカーは「何が動いているか」を示し、「何が変わったか」までは示さない。**監視の開始が製品の変更より遅いと、異常の開始時刻が実際の混入時刻より後になる**。原因は `git log` と PR の履歴（frontend の直近の変更）から特定した。リリースと異常の相関を正しく取るには、監視を製品の変更より先に動かしておくことが要る。

**できていないこと**:

- **リリース済みイメージを対象にした実行**: 手動の通常 2 回（v1.0.0 公開前）はフォールバック（main の HEAD）で、`release_tag` は null、`matches_latest_release` は null だった。v1.0.0 公開後の Actions 上の通知試験 2 回（run 38154528493・38155028980）と、**通常の schedule 実行 4 回**では、GHCR の digest 解決と release モードでの起動（`mode: release`、`matches_latest_release: true`）が動いた。イメージ名の不一致でフォールバックに落ちる事象は、公開後の実行では起きていない。
- GitHub-hosted runner では実行ごとに前回のマーカーが無いため、`version_changed_at` は付かず、リリースの公開時刻（`release_published_at`）を起点にする。
- **「release と異常の相関の定期的な分析」は未実施**。本物の incident が 2 件（#36 は監視の誤検知、#59 は schedule の空白）で、いずれもリリースとは無関係。分析の対象が無い。

## monitoring-14 Incident・Feedback

**結論**: 本物のインシデントは **1 件（#36）**。**defect・テスト・監視・runbook のすべてに還流**した（4 つの還流先 + PR テンプレート）。還流の効果（再発率）は、**件数が 1 件で観測期間が 1 日に満たないため測れていない**。

**インシデント #36（MON-008 J-02 の誤検知）**: 一次情報は Issue #36、PR #39、`monitoring/fp-fn-log.md`。（定義上は incident と defect を兼ねる。#36 の本文は PR #51 で、起票時の本文を残して defect の項目を追記した形に復元した。）

| 項目 | 内容 |
|---|---|
| 検知 | 2026-10-11 12:43 UTC、初回の Actions 実行（run 38140285304）で MON-008 が失敗（2 試行とも `locator.check: Clicking the checkbox did not change its state`）。incident Issue #36 が約 37 秒後に自動起票（assignee 設定済み、sev2、runbook RB-004 へのリンク、直前のデプロイ付き） |
| 原因 | 製品の挙動修正 PR #12（「チェックは API 成功後にだけ反転する」。製品は設計どおり）に、監視の `check()` が追随していなかった。**製品の不具合ではない（誤検知）**。混入工程: test、原因分類: process、検出可能だった工程: review |
| 回復 | PR #39 の修正（`click()` + `toBeChecked()`）を含むブランチで `synthetic.yml` を再実行 → 12:55:57 に成功 → #36 に回復コメントが付き 12:56:26 に**自動 close**（run 38141090678）。起票から約 12 分 |
| 影響 | 実害は無い。誤検知の incident が 1 件立ち、ack・調査の手間が出た |

**還流先**:

| 還流先 | 実施した内容 | 記録 |
|---|---|---|
| **defect** | Issue #36 を `defect` 票として補筆（検出工程 monitoring、混入工程 test、重大度 minor、原因分類 process、修正 PR #39、検出可能だった工程 review）。ID は DEF-036（= Issue 番号 3 桁）。`docs/data/defects.csv` には、PR #42（2026-10-11T16:30:20Z マージ）で DEF-036 の行が入った（修正済み・minor。2026-10-12 に確認） | Issue #36（編集履歴を含む） |
| **テスト** | 監視ジャーニー `e2e/synthetic/journey.spec.js` の `[MON-008]` を修正（`click()` と `expect(...).toBeChecked()`、行の `aria-busy` の解除も待つ。操作の取り方は E2E の `e2e/fixtures/todo-app.js` と揃えた）。旧版が現行の frontend で失敗することを手元で再現してから直した。**新しい TC-xxx は追加していない**（「製品の振る舞いの変更を含む PR で、監視ジャーニーが成功すること」のケース案は Issue に書いたが、`cases.csv` には無い） | PR #39 |
| **monitor** | MON-008 の定義と操作の取り方を修正。`monitoring/fp-fn-log.md` に誤検知として 1 行 | PR #39、`fp-fn-log.md` |
| **runbook** | RB-004 の切り分け表に「`Clicking the checkbox did not change its state`（`check()` / `uncheck()` の直後の検証が失敗）」の行を追加（製品の操作の仕様変更に監視が追いついていない場合の確認と対処） | PR #39、`runbooks/RB-004-browser-journeys.md` |
| **プロセス** | PR テンプレートに「画面・API の振る舞いを変えた場合、外形監視（`monitoring/`・`e2e/synthetic/`）の期待が変わらないか確認した（変わるなら同じ PR で直す）」を追加。`monitoring/README.md` の「変更の手順」にも運用規則を追加 | PR #39、`.github/PULL_REQUEST_TEMPLATE.md` |

**訓練・試験から出た還流（インシデントではないが同じ仕組み）**: 通知試験の初回（#13・#14）で見つかった 3 つの不備（失敗詳細の重複・影響欄が空・版が不明）を修正して再実施した。rollback 訓練で見つかった `COMMIT_SHA` の問題は #16 に起票し、PR #19 で直し、訓練を再実施して確認した。

**還流の仕組み**: incident Issue のテンプレート（`.github/ISSUE_TEMPLATE/incident.md`。自動起票も同じ書式）に「再発防止（還流先）」として defect・テスト・監視・runbook の 4 項目と、close 時の「振り返り」（原因・検出できた工程・監視は期待どおり鳴ったか・同種の再発）を持つ。close するときは各項目を「実施（記録: Issue / PR / TC 番号）」か「不要（理由）」にする規則。

**できていないこと**:

- **還流の効果（再発率）は測れていない**。インシデントが 1 件、観測が 1 日に満たず、再発の有無を言える状況ではない（修正後の schedule 実行は 4 回で、MON-008 を含め 11/11 成功。ただし観測は約 14 時間）。「同種の障害が再発していないか」は、schedule の実行が積み上がってから月次の見直しで確かめる。
- **#36 の本文は、以前は欠陥票の書式に書き換えられ、起票時の「再発防止（還流先）」チェックリスト・直前のデプロイ・ack 欄が残っていなかった**。PR #51 で復元し、還流先の 4 項目（defect・テスト・監視・runbook）にチェックと記録が付いた現行の本文で、incident 票の規則（close 前に全項目を「実施」か「不要」にする）を満たす。incident と defect を兼ねる場合は本文を上書きせず追記する規則を README・テンプレートに書いた。
- 「テスト」の還流は、監視ジャーニーの修正（テスト資産の修正）で、**回帰ケース（TC）としては増えていない**。監視の期待が製品の変更に追随しているかを確かめるケース（案は #36）は、まだ作っていない。

## できていないこと・次の一手（まとめ）

| 項目 | 状態 | 次の一手（提案。期日は提案で、マージで承認される） | 担当ロール |
|---|---|---|---|
| schedule の実行間隔が定義（30 分）と合わない（実績は 3〜7 時間。synthetic 4 回・watchdog 2 回） | 原因は GitHub の schedule の遅延・欠落と見られるが未確認。#59 で死活監視が実際に起票した | `event=schedule` の間隔を継続して記録する。差が続くなら間隔の定義を実態に合わせるか、schedule に頼らない手段（外部の常駐監視）を決める。#59 の切り分け・還流のチェックリストを埋める | 運用（SRE）担当、プロダクトオーナー |
| 通常実行でのリリース済みイメージの監視が未実施 | 通常の 2 回はフォールバック。通知試験 2 回は release モードで動いた | `Run workflow`（`force_fallback` なし、`drill` なし）で release モードの通常実行を確認 | 運用（SRE）担当 |
| 通知試験の定期実施 | 5 回すべて 2026-10-11（同じ日） | 90 日に 1 回、`drill: true` で実施し、`alert-tests.md` に追記（次回の期限 2027-01-09） | 運用（SRE）担当 |
| 設定の検査が PR の CI に無い | **解消**（PR #51: lint ジョブで `check-config.mjs` と単体テストを実行。基盤の失敗は MON-META で起票。死活監視の起票は #59 で実際に確認できた） | — | 運用（SRE）担当、開発リード |
| MON-007 の latency の定義と実装の食い違い | **解消**（PR #51: spec が `screen_ready_ms` 2,000 ms を測る。schedule 4 回で成功を確認） | `ready` の実測値を履歴に残すか決める（現在は ok・fail のみ） | 運用（SRE）担当 |
| RB-003・RB-004 が未訓練、RB-005 は MON-META の通知試験のみ、digest 固定での rollback 訓練が未実施 | 未訓練 | 個別の不具合を作る訓練、前のリリースがあるときの rollback 訓練 | 運用（SRE）担当 |
| DNS・TLS の監視、多地点、1 分間隔 | できない（本番が無い） | 本番を持つと決めたときに、常駐の監視と複数地域・TLS・DNS を足す | プロダクトオーナー |
| 通知が人に届く経路・代理の担当 | 無い（単一メンテナ） | 複数人になったら on-call のロールを team に変え、外部通知を足す | プロダクトオーナー |
| 月次の誤検知・見逃しの見直しと集計 | 未実施 | schedule の履歴が積み上がってから月次で実施（現在 schedule は約 14 時間・4 回） | 運用（SRE）担当 |

## 変更履歴

| 版 | 日付 | 内容 | 作成 | レビュー | 承認 |
|---|---|---|---|---|---|
| 1.0 | 2026-10-12 | 初版（v1.0.0 の外形監視・運用品質の判断と実績。PR #51 より前の値） | 運用（SRE）担当（AI エージェントが作成） | QA リード（未実施） | プロダクトオーナー（PR #43 のマージ＝承認の代行。オーナーの確認は未実施） |
| 1.1 | 2026-10-12 | PR #51 の反映と数え直し: Actions 上の通知試験 3 回（1 回は fail → 修正 → pass、1 回は MON-META の基盤試験）、`synthetic.yml` の Actions 実行は手動 5 回、schedule 4 回（2026-10-12 17:00 JST 時点。それ以前は 0 件。間隔は 3〜7 時間で 30 分でない）、死活監視の 2 回の実行と #59（本物の MON-META）、MON-META・`monitoring-watchdog.yml`（3 時間ごと）、v1.0.0 のイメージを digest 固定で起動した drill、MON-007 は応答時間（ready 2,000 ms）を測る形に、単体テスト 27 → 34 件、設定の検査が PR の CI に入った、#36 の本文の復元、EXC-004 の見直し日を plan-03 に一致 | 運用（SRE）担当（AI エージェントが作成） | QA リード（未実施） | プロダクトオーナー（PR のマージ＝承認の代行。オーナーの確認は未実施） |
