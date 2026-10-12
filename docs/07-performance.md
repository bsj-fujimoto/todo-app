# 07 負荷・性能試験成果物

| 項目 | 内容 |
|---|---|
| 文書ID | DOC-07 |
| 版 | 1.0 |
| 更新日 | 2026-10-12 |
| 状態 | draft（オーナーの確認待ち。PR マージ＝承認の代行） |
| 対象 | todo-app 仕様書 v1.1（spec/todo-phase1-spec.html）、リリース v1.0.0（commit 5fcf40a7e58dc253e53ff56860d0669a69abda26） |
| 作成 | QA 担当・運用（SRE）担当（ロール。実作業は AI エージェント） |
| レビュー | QA リード（未実施。作成者と別ロールだが兼務で、第二の目は無い） |
| 承認 | プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ。オーナーの確認が済むまで draft のまま） |
| 正本 | この md と、[perf/](../perf/README.md)（`slo.yaml`・`workload.yaml`・`environment.yaml`・`environment.md`・`analysis.md`・`baseline.json`・`regression-threshold.yaml`・`k6/`・`screen/`・`results/`・`experiments/`）、`scripts/perf/`、[.github/workflows/perf.yml](../.github/workflows/perf.yml)、[docs/evidence/perf/](evidence/perf/SOURCE.json)（Git が版管理） |

本書は、todo-app の性能を**どの数字で合格と決め、どの負荷で測り、何が分かり、何が分からないか**をまとめる。
設定・スクリプト・結果の実体は `perf/` と `docs/evidence/perf/` が正本で、本書は方針・読み方・判断・できていないことを書く。**数字はすべて出典（パス・Issue・run）を付けた**。

## 結論

- **想定負荷（20 req/s・1,000 件）で SLO は全達成**。GitHub-hosted runner のタグ v1.0.0 上の本計測（run 38152548008、3 反復）で、一覧 p95 19.5ms（目標 500）、追加 18.4ms・完了切替 15.9ms・削除 14.1ms（目標 300）、エラー率 0%（目標 < 1%）、health p95 29.7ms（目標 200）、画面表示完了 p95 158.1ms（目標 2,000）、Lighthouse performance・accessibility とも 1.0。全体判定は pass（[verdict.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/verdict.json)）。
- **この負荷は想定ピークの 40 倍**（想定ピーク 0.5 req/s × 安全率 40 = 20 req/s）。目標に対して 2 桁の余裕がある。性能が問題になるのは想定ピークではなく、**過負荷（stress の膝は 100 req/s、200 req/s で 45% エラー）と件数の増加**（runner では 5,000 件までが SLO 内、7,500 件で一覧 p95 5,455ms）。原因は backend の **CPU 飽和（1 vCPU・Node の単一スレッド）** と、**1 要求のコストが件数に比例する設計**（Issue #31・[DEF-031](data/defects.csv)。改善は [ACT-006](data/actions.csv)）。
- 3 反復の分散は想定負荷で 1% 未満（一覧 p95 の標準偏差 0.12ms = 0.6%）。ただし**膝・飽和域では揺れる**（stress 100 req/s の一覧 p95 は 162 / 174 / 205ms）。
- 試験種別は load・stress・spike・soak・capacity・画面計測の 6 種を、すべて 3 反復（画面は 10 回）で実施した。
- **できていないこと（正直に）**:
  - **本番も実測ログも無い**。ワークロード（想定ピーク 0.5 req/s）は**想定**で、絶対値は本番の予測値ではない（performance-02・13）。
  - **runner の baseline は 1 回の run から作った**。run 間のノイズは分かっていない。perf.yml の定期実行（週次）はまだ 1 回も動いていない（performance-07・12）。
  - **soak は 10 分版のみ**。長時間版（2 時間以上）は未実施（performance-03）。
  - **観測は docker stats（CPU・メモリ）・health 応答時間・SQLite ファイルサイズだけ**。APM は未導入で、queue と外部依存はアーキテクチャに存在しない（performance-08）。
  - **水平スケールできない**（SQLite の単一ファイル）。容量を増やす手段は設計変更（改善案 A・C）で、CPU の追加は +50% 止まり（performance-10・11）。
  - 時間依存の傾向（trend）は、**環境の区分ごとに run がまだ 1 つずつ**（開発機 1・runner 1）で、傾向と呼べない（performance-12）。

## 前提と読み方

- **本番環境が無い**（[SECURITY.md](../SECURITY.md)、[ai-context.yaml](ai-context.yaml) の `product.criticality: low`）。利用者は 1 人（1 インスタンス = 1 人。認証なし）で、サービス区分は best-effort。SLO の値には**想定**（`basis: assumed`）が混ざる（performance-01）。
- 測定した環境は 2 つ。**本計測 = GitHub-hosted runner**（`github-hosted:ubuntu24:X64`、タグ v1.0.0 上の run 38152548008。結果を `docs/evidence/perf/` に取り込んだ）、**参考 = 開発機**（`local:darwin-arm64`。Apple M5 Pro の Docker Desktop。`perf/results/` に要約をコミット）。本書の数字は、断りがなければ本計測（runner）。2 つは CPU が違い、**同じ値にならず、混ぜて比べない**（baseline も環境の区分ごと）。
- 開発機の baseline の commit（`f948648`）と runner の commit（v1.0.0 = `5fcf40a`）は別で、`git diff f948648 5fcf40a` の差は `backend/Dockerfile`・`frontend/Dockerfile`・`frontend/nginx.conf`・`docker-compose.yml` とフロントの単体テストで、**`backend/src` に差は無い**。
- k6 の生ログは巨大なため `docs/evidence/perf/` には取り込まず、`manifest.json` の sha256 で参照する（`skipped_large_files` は 0。生ログは Git 管理外で、Actions artifact `perf-results-38152548008` に 90 日保存）。取り込みの出所は [SOURCE.json](evidence/perf/SOURCE.json)。
- 機能層の性能テスト（TC-073・TC-074）は「桁が違う劣化を見つける番兵」で、**SLO の本判定は perf 層**（[ADR-0005](adr/0005-functional-layer-perf-sentinel.md)）。本書が扱うのは perf 層。

### 試験の全体像

| 層 | 何で | いつ動く | 判定 |
|---|---|---|---|
| 番兵（機能層） | [TC-073](data/cases.csv)（API 一覧 1,000 件）・[TC-074](data/cases.csv)（画面表示完了）。CI ではしきい値を 3 倍 | 全件回帰・PR | 絶対時間の番兵（任意区分。リリース判定に含めない） |
| **本判定（perf 層）** | k6（load・stress・spike・soak・capacity）+ Playwright / Lighthouse（画面）。[perf.yml](../.github/workflows/perf.yml) が [run.sh](../scripts/perf/run.sh) を実行 | 手動（workflow_dispatch）・週次（月曜 03:17 UTC）・release.yml が最新の成功 run の結果を添付 | `verdict.mjs`（SLO）・`compare.mjs`（退行）。**PR ごとには動かない** |

## performance-01 目的・SLO・合格基準

**結論**: SLO は `perf/slo.yaml` の **10 項目**で、すべてに数値目標・演算子・単位・統計量・出典・利用者影響がある。このうち perf 層が判定するのは 9 項目（k6 の load が 8、画面計測が 1）で、残り 1 項目（`availability_synthetic_ratio`）は外形監視（[11 外形監視](11-monitoring.md)）が判定する。判定は全 run が `perf/slo.yaml` を参照する（`verdict_rule.slo_ref`。本計測の 6 run すべて）。

**SLO 一覧**（正本: [perf/slo.yaml](../perf/slo.yaml)）

| metric | 統計量 | 目標 | 判定する試験 | 根拠（basis） | 利用者影響 |
|---|---|---|---|---|---|
| `api_list_p95_ms` | p95 | ≤ 500 ms | load（TC-073） | provisional-confirmed | 起動直後・再読込のたびに一覧が出るまで待たされる。500ms を超えると「遅い」と感じ始める |
| `api_list_p99_ms` | p99 | ≤ 1,000 ms | load | assumed | 数十回に 1 回の遅い表示。1 秒を超えると画面が固まったように見える |
| `api_create_p95_ms` | p95 | ≤ 300 ms | load（TC-073） | provisional-confirmed | 追加ボタンから一覧に反映されるまでの待ち（成功確認後に反映する仕様のため、そのまま体感になる） |
| `api_update_p95_ms` | p95 | ≤ 300 ms | load（TC-074） | assumed | チェックを入れてから反映されるまでの待ち |
| `api_delete_p95_ms` | p95 | ≤ 300 ms | load（TC-074） | assumed | 削除ボタンから行が消えるまでの待ち（確認画面が無く即時削除） |
| `screen_ready_ms` | p95 | ≤ 2,000 ms | screen（TC-074） | provisional-confirmed | 開いてから使えるまでの待ち。全件描画のため件数に比例して劣化する |
| `error_rate` | rate | < 0.01（1%） | 全シナリオ | provisional-confirmed | 保存失敗の表示が出る割合。1% 超だと「ときどき保存できない」アプリになる |
| `throughput_rps` | 達成率 | ≥ 0.95（到着率の 95%） | load | assumed | 処理が追いつかず要求が捨てられる割合の裏返し |
| `health_p95_ms` | p95 | ≤ 200 ms | load（観測プローブ） | assumed | 負荷中でも死活判定が遅れない。遅いと外形監視が遅延を停止と誤認する |
| `availability_synthetic_ratio` | rate | ≥ 0.99 | **外形監視**（perf の対象外） | assumed | 利用者が使えなかった時間の割合の代用（本番が無いため、外形監視の実行成功率で代用） |

- **値の由来**: `provisional-confirmed` 4 件は [02](02-test-perspectives.md)・[03](03-test-spec.md) の暫定しきい値を変えずに確定したもの、`assumed` 6 件は本ファイルで新設した**想定**（実利用の実測が無い）。想定の数字を実測のように扱わない。
- **適用条件**: 1,000 件（DS-006）、単一インスタンス（compose）、認証なし。1,000 件を超える件数は capacity で別に測り、SLO の対象外（容量計画の指標。performance-11）。
- **対象外（理由付き）**: 同時接続 100 以上（1 人用で同時利用者は 1〜3。stress で上限を見るだけ）、画面の Core Web Vitals の SLO（Lighthouse は観測値として記録し、合否は `screen_ready_ms`）。いずれも `slo.yaml` の `out_of_scope` に理由を書いて除外している。**承認者**: プロダクトオーナー（`slo.yaml` を入れた PR #32 のマージ 2026-10-11 をもって承認。フェーズ1は AI が代行マージ）、**見直し日**: 2026-12-15（ACT-006 の期限に合わせる。本書で設定）。見直し条件: UNK-002 の件数上限の決定。
- **画面の判定値**: `slo.yaml` の description は「10 回計測の最大値で判定」と書くが、実装（`verdict.mjs`）は p95（線形補間）で判定している（本計測: p95 158.1ms、最大 177.9ms。どちらも目標 2,000ms 内）。記述の食い違いは直す対象（最終報告で依頼）。
- **外形監視との接続**: 監視 monitors.yaml の各 SLI が `slo_ref` で `perf/slo.yaml` の metric を参照する（[11](11-monitoring.md)）。

## performance-02 ワークロードモデル

**結論**: ワークロードは**想定であって実測ではない**（`workload.yaml` の `basis: assumed`）。本番も実測ログも無いため、個人用 ToDo の使われ方から理屈で導出し、安全率 40 を掛けて load の負荷にした。したがって「本番の実測から導出」は満たせない。本番ログが得られたら想定値を実測に置き換える（置換先は `workload.yaml#derivation`）。

| 要素 | 値 | 根拠・導出（出典: [perf/workload.yaml](../perf/workload.yaml)） |
|---|---|---|
| **同時数** | 利用者 1、同時に開く端末は最大 3（スマホ・PC・複数タブ）。k6 の VU は初期 10・上限 100 | 認証なし・1 人 1 インスタンス。VU は到着率 20 req/s を捌くための目安で、利用者数ではない |
| **到着率** | 想定ピーク **0.5 req/s**、load は **20 req/s**（想定ピークの 40 倍、オープンモデル） | 1 日 100 操作 ÷ 3 回の集中（朝昼夕・各 10 分）= 約 0.06 操作/秒。最速の人が連続操作する上限 1 操作 2 秒 = 0.5 操作/秒を想定ピークとし、安全率 40（複数端末・自動化クライアント・再試行・外形監視を含めても収まる大きさで、5 分で 6,000 要求の統計量が取れる） |
| **操作比率** | load・capacity: 一覧 60 / 追加 25 / 完了切替 10 / 削除 5（%）。stress・spike・soak: 一覧 60 / 追加 15 / 完了切替 10 / 削除 15 | 1 日 100 操作の内訳と同じ比率。stress・spike・soak は追加と削除を同数にして件数を 1,000 前後に保ち、「負荷による劣化」と「件数による劣化」を分ける（soak の最初の fail の教訓。performance-10） |
| **データ量** | 通常 1,000 件（DS-006）。成長の上限 10,000 件 | 件数の上限は未決（[UNK-002](data/unknowns.csv)。回答期限 2026-10-16）。load 中は追加 25%・削除 5% で 5 分に約 +600 件増える（実利用でも同じ向き） |
| **成長予測** | 追加 25・削除 5 件/日で正味 +20 件/日。現状 1,000 件 → 1 年後 7,300 件（最悪ケース、完了済みを消さない使い方）→ 10,000 件（約 500 日後） | 1 日 100 操作の想定から。0 件から 1,000 件までは約 50 日 |
| **根拠の限界** | 100 操作/日・集中の仕方・安全率 40 はいずれも想定。実利用が別の使い方なら前提が崩れる | `workload.yaml` の `limits_of_derivation`。利用者が 1 人なので「同時 100 ユーザー」型の負荷は作っていない |

- **オープンモデル（到着率固定）**を使う。応答が遅くなっても到着は減らないので、飽和で待ち行列が伸びる様子（遅延の急増・取りこぼし）が出る。VU 固定（think time あり）のクローズドモデルは、遅くなると要求が自然に減って限界を隠す（[perf/README.md](../perf/README.md) 設計判断 1）。
- 操作の選択は乱数を使わない決定的な表（20 スロットを互いに素な歩幅で巡回）で、再実行しても同じ列になる。
- 承認: 想定ピークと安全率の妥当性を確認した人はいない（兼務のオーナーが PR のマージで受け入れた時点が承認）。実利用の実測で妥当性を確かめられるのは、実利用が始まってから。

## performance-03 試験種別

**結論**: 要求シナリオ 5 種（load・stress・spike・soak・capacity。[ai-context.yaml](ai-context.yaml) の `strategy.performance.required_scenarios`）をすべて実施し、画面計測を加えて 6 種。いずれも run ごとに warm-up 30 秒（画面は読込 3 回を捨てる）の後、3 反復（画面は 10 回）で計測した（run 38152548008）。

| 種別 | スクリプト | 目的（選んだ理由） | 負荷・長さ | SLO との結び付き | 本計測の判定 |
|---|---|---|---|---|---|
| load | `k6/load.js` | 想定負荷で SLO を満たすかを判定する | 20 req/s・300 秒・3 反復 | **SLO 8 項目を判定** | pass |
| stress | `k6/stress.js` | SLO を割り始める点（限界点）と壊れ方（飽和資源）を探す。想定ピークに対する余裕の測定 | 20→50→100→200→400→800 req/s、各段 5 秒で到達し 60 秒保持・3 反復 | SLO の合否は判定しない（限界点を求める。`max_sustained_rps` = **100**、最初の違反 **200 req/s**） | pass（判定対象外のため、限界点の記録） |
| spike | `k6/spike.js` | 急なアクセス増（ブラウザの再試行・自動化の暴走）からの回復を見る | 20→400 req/s を 10 秒で跳ね上げ 60 秒保持→20 に戻す・3 反復 | 戻ってから 30 秒以内に一覧 p95 が SLO 内・エラー < 1% に戻ること（`list p95 ≤ 500`・`error_rate < 0.01`） | pass（回復 15〜20 秒） |
| soak | `k6/soak.js` | 時間とともにメモリ・DB サイズ・応答が劣化しないか（リーク・断片化） | 20 req/s・**10 分**（CI 短縮版）・3 反復。追加=削除で件数一定 | 一覧 p95 が SLO 内・エラー < 1%・前半→後半の悪化 ≤ +20%・メモリ +20% で警告、+50% で fail | pass（drift −17%） |
| capacity | `k6/capacity-step.js`（件数は `seed.js` で増やす） | 件数の増加（成長予測）で応答がどう伸びるか。容量計画 | 件数 1,000→2,500→5,000→7,500→10,000、各 20 req/s を 60 秒・3 反復 | 1,000 件（SLO の適用範囲）は SLO 内が必須（fail）。それを超える件数は警告（`max_tasks_within_slo`） | pass（警告 2 件: 7,500・10,000 件で目標超過） |
| screen | `screen/measure.mjs` | 1,000 行の全件描画までの時間（TC-074）。件数比例の劣化を画面で確認 | キャッシュなし 10 回 + Lighthouse 3 回（1,000 件）、10,000 件も観測 | `screen_ready_ms` ≤ 2,000ms | pass |

- **選定の考え方**: 「想定負荷で合格か（load）」「どこで壊れるか（stress）」「壊れた後に戻るか（spike）」「時間で劣化しないか（soak）」「件数で劣化しないか（capacity）」は、それぞれ別の質問で別の試験が要る。1 人用なので、同時接続数を増やす試験（同時 100 ユーザー）は作らない。
- **実施しなかった・足りないもの**: 長時間 soak（2 時間以上。`SOAK_DURATION_SEC=7200`）は未実施。耐久（数日）・障害注入（backend の再起動中の負荷など）・コールドスタート直後の計測も無い。ネットワーク遅延・帯域・TLS を入れた試験も無い（環境に存在しない。performance-04）。
- **結果の置き場**: 開発機の 3 反復の run（`20261011T082949Z-f948648`）と実験 run は [perf/results/](../perf/results/)、runner の本計測は [docs/evidence/perf/](evidence/perf/SOURCE.json)。

## performance-04 環境の代表性

**結論**: 実在する本番は無い（`environment.yaml` の `reference_production.exists: false`）。想定本番は「個人が使う小さな VM（1 vCPU・1 GiB・SSD・docker compose・TLS 終端は別）」。測定環境はこれに**資源の上限を合わせた**が、**CPU の速さは揃えられていない**。絶対値は本番の予測値ではなく、相対比較（退行・件数の傾き・飽和の仕方）に使う。

- **規模比（scale_ratio）**: **1.0**（backend の CPU 上限 1 vCPU を想定本番に合わせた比。コアの速度差は含まない）。台数は 1（水平スケールしない構成）。
- **mock（mocks）**: **なし**（`[]`）。外部サービスが存在せず（backend は SQLite だけに依存）、疑似応答に置き換えたものは無い。本番で加わる外部の遅延は、そもそも存在しない。
- **制限（limits）**: backend `cpus=1.0`・メモリ 512MiB、frontend（nginx）`cpus=0.5`・128MiB（[perf/compose.perf.yml](../perf/compose.perf.yml)）。k6 は同じ Docker VM の別コンテナ（上限なし）で動き、負荷生成と被試験側が同じホストの CPU・メモリ・ネットワークを共有する。TLS 終端なし（HTTP）。実ネットワークの遅延・帯域なし（compose の内部ネットワーク）。
- **注記（notes）**: 本番が無いので絶対値は本番の予測値ではない。相対比較に使う。比較は同じ環境の区分（`env_class`）の run 同士でだけ行う。

**差異ごとの外挿への影響**（[environment.md](../perf/environment.md)・[environment.yaml](../perf/environment.yaml)）

| 差異 | 外挿への影響 | 向き |
|---|---|---|
| CPU の速さ（M5 の高性能コア・EPYC 7763 の vCPU vs 一般的なクラウド VM の vCPU） | CPU 律速の限界点は、本番では**低くなる**可能性が高い。倍率は未測定。runner（x86・4 vCPU）は開発機より p95 で 1.3〜1.8 倍遅く、飽和域では桁が変わる | 本番はどちらかより遅いかもしれない |
| CPU 上限の与え方（cgroup の `cpus: 1.0`） | 実 VM の 1 vCPU と同じではない（共有コア・バースト・ノイジーネイバー）。上限は揃えたが速度は揃っていない | 不明 |
| ファイル I/O（SQLite のファイルは Docker のボリューム） | SQLite の journal_mode=DELETE（既定）で書込みごとに fsync があり、ディスク依存が大きい。本番ディスクで書込み遅延が変わる。高負荷での fsync の効きは未分離（実験していない） | 不明 |
| 負荷生成と被試験が同じホスト | k6 の CPU も同じ VM を使う。開発機では k6 の CPU は 35% 以下で律速ではなかったが、runner（4 vCPU 共有）では k6 の CPU が p95 82〜92%（最大 111%）に達し、**stress の高負荷段では負荷生成側の飽和が混ざりうる** | 限界点を低く見積もる側 |
| 外部ネットワークなし・TLS なし | 実ネットワークの遅延・TLS ハンドシェイクが無い。本番の体感（表示完了など）はその分だけ遅い | 本番は遅い |
| データの分布（連番の短いタイトル 11 文字前後） | 実利用の長いタイトルは一覧のレスポンスが大きく、JSON 生成の CPU が増える | 本番は遅い |
| 利用者数（1 人の操作を安全率 40 の到着率で再現） | 複数利用者・端末の同時利用（SQLite の書込みロック競合など）は対象外 | 不明 |
| コンテナのイメージ・commit | 開発機の baseline は commit `f948648`、runner は `5fcf40a`。`backend/src` は同じだが Dockerfile・nginx.conf・compose に差がある | 小（backend のコードは同じ） |

**測定環境の 2 つの区分**（`run.json` の記録。runner の値は [run.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/run.json)）

| 項目 | 開発機（`local:darwin-arm64`） | GitHub-hosted runner（`github-hosted:ubuntu24:X64`） |
|---|---|---|
| CPU | Apple M5 Pro（Arm）15 コア（Docker VM に 15 vCPU・7.75 GiB） | AMD EPYC 7763（x86_64）4 vCPU・15.6 GiB |
| OS / Docker | macOS 27.0.1 + Docker Desktop 29.8.2（Linux VM 上で動く） | Ubuntu 24.04.5 LTS（kernel 6.17.0-1022-azure）、Docker 28.0.4 ネイティブ |
| 負荷の同居 | k6 と被試験が同じ VM（15 vCPU） | k6 と被試験が同じ 4 vCPU を共有（被試験は `cpus` 上限で固定） |
| k6 | v2.3.0（linux/arm64） | v2.3.0（linux/amd64、同じ digest） |
| 所要 | 約 2 時間 | 約 2 時間 23 分 |

## performance-05 データ量・分布

**結論**: 1,000 件（DS-006）を API 経由で投入して計測し、capacity で 10,000 件まで増やした。ただし**本番の件数・分布の実測が無い**ため、本番分布との比較はできていない（`vs_prod_ratio` の 1.0 は「想定本番の通常件数 1,000 件と同じ」という意味で、実測の本番との比ではない）。

- **データ量（volume）**: 通常 **1,000 件**（DS-006: タスク-0001〜タスク-1000、偶数番 500 件が完了済み）。capacity は 1,000 / 2,500 / 5,000 / 7,500 / 10,000 件。画面は 1,000 件と 10,000 件。投入は `k6/seed.js` による API 経由（`POST /api/v1/tasks`）で、1 トランザクションの一括投入 `seedTasks()` は backend 内部関数のため使わない。
- **本番比（vs_prod_ratio）**: **1.0**（想定本番の通常件数と同じ。実測の本番件数は無い）。成長の上限 10,000 件は想定本番の 10 倍。
- **偏り（skew）**: タイトルは連番（11 文字前後）で長さがほぼ均一、偶数番が完了済み（50%）。実利用の偏り（長短・未完了が多い）は**再現していない**。レスポンスサイズは実際より小さめに出る（1,000 件で 30,678 bytes。10,000 件で 308,674 bytes。runner の screen.json）。
- **キャッシュ（cache_state）**: warm-up 30 秒（5 req/s）の後。接続・JIT・SQLite のページキャッシュが温まった状態。各反復は DB ボリュームを作り直して始める。**コールドスタート直後の遅さは計測対象外**。画面計測はキャッシュなしの新規ブラウザコンテキストで読込 3 回を捨ててから 10 回。
- **履歴量（history_depth）**: 履歴を持たない（ToDo に更新履歴は無い）。`createdAt` は backend が採番するため、DS-006 の「1 秒間隔」は API 経由の投入では再現できない（投入は数秒で終わる）。
- **データが測定中に動く**: load は 5 分で約 +600 件増える（追加 25% > 削除 5%）。soak は追加=削除で件数を一定に保つ（本計測: DB ファイル 155,648 → 159,744 bytes、+4 KB）。

| 件数 | 一覧のレスポンス | 画面の表示完了 p95（runner） | 出典 |
|---|---|---|---|
| 1,000 | 30,678 bytes | 158.1ms | [screen.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/screen/screen.json) |
| 10,000 | 308,674 bytes（約 301 KiB） | 583.2ms（約 3.7 倍） | [screen-10000.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/screen/screen-10000.json) |

## performance-06 ツール・Script・版

**結論**: ツール・版・スクリプトの sha256・設定の sha256・commit を **run ごとに自動で記録**し、イメージは digest で固定している。本計測の 6 run（load・stress・spike・soak・capacity・screen）すべてに 6 項目（tool・版・script パス・script sha・config sha・commit）が揃う（[perf-runs.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/perf-runs.json)）。

| 項目 | 固定している値 | 出典 |
|---|---|---|
| 負荷ツール | k6 v2.3.0（`grafana/k6@sha256:e66db15b8601…`、digest 固定。go1.27.1） | `run.sh` の `K6_IMAGE`・`run.json` の `k6` |
| 画面計測 | Playwright 1.64.0 + Lighthouse 13.5.0 + Chromium（`mcr.microsoft.com/playwright:v1.64.0-noble`、digest 固定）。依存は `perf/screen/package-lock.json` | `perf/screen/Dockerfile`・perf-runs.json |
| 被試験イメージ | backend `node:24-alpine@sha256:ebfe2f90…`、frontend `nginxinc/nginx-unprivileged:stable-alpine@sha256:15c994d1…`（いずれも digest 固定。run ごとに compose がビルド） | perf/environment.md・run.json の `containers` |
| 判定・観測の実行 | Node 24（mise）。依存は `yaml` のみ（`npm ci`） | perf.yml |
| commit | 製品 commit `5fcf40a7e58dc253e53ff56860d0669a69abda26`（v1.0.0）、`dirty: false` | run.json |
| スクリプトの hash | `perf/k6/*.js`・`perf/screen/*`・`scripts/perf/run.sh`・`scripts/perf/lib/rules*.mjs` の sha256 を 14 件記録（例: `load.js` = `4f19a6a5…`、`run.sh` = `a9dda19c…`） | run.json の `script_sha256` |
| 設定の hash | `slo.yaml`・`workload.yaml`・`regression-threshold.yaml`・`compose.perf.yml`・`environment.yaml`・`docker-compose.yml` の sha256 を 6 件記録（例: `slo.yaml` = `5f585a79…`） | run.json の `config_sha256` |
| 全ファイルの hash | k6 の生ログを含む全ファイルの sha256 | `manifest.json` |
| 環境 | runner 名・イメージ版（ubuntu24 `20261004.327.1`）・CPU・メモリ・Docker・kernel | run.json の `runner`・`host`・`docker` |
| 実行の入口 | `scripts/perf/run.sh --profile ci --run-id gha-<run>-<sha7>`（run ID は UTC 日時や GitHub run ID + commit） | perf.yml |

- **再現できることの確認（範囲を限って）**: ①条件の再現: 同じ commit・同じ設定・同じ digest で、開発機（run `20261011T082949Z-f948648`）と runner（run 38152548008）の両方を実行し、判定規則と記録の形が同じになった。②値の再現: 開発機で load だけを再実行した run `load-compare-20261011T115828Z-191a25b`（約 3.5 時間後。commit `191a25b`）は、baseline と比べて 8 指標とも退行 0 件（一覧 p95 10.65 → 9.85ms = −7.5%、削除 p95 −20.7%、悪化側は無し。[compare.json](../perf/results/load-compare-20261011T115828Z-191a25b/compare.json)）。**runner では、同じ条件の 2 回目の run がまだ無く**、「同じ条件で同じ値が出る」ことは runner では確認していない（performance-07）。
- 判定ロジックの単体テストは 17 ケース（[scripts/perf/test/stats-and-rules.test.mjs](../scripts/perf/test/stats-and-rules.test.mjs)。2026-10-12 に手元で 17 件 pass を確認）。CI の ci.yml と perf.yml の先頭で実行する。

## performance-07 Warm-up・反復・再現性

**結論**: warm-up 30 秒・3 反復・分散（標準偏差と 95% 信頼区間）・同じ環境の区分での比較を、すべての run で統制した。想定負荷では反復間のばらつきが 1% 未満で、再現性は高い。**一方、runner の run 間のノイズ（別の日・別のホスト）は 1 回の run からは分からない**。

| 統制 | 内容（出典: [perf/README.md](../perf/README.md)・[verdict.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/verdict.json)） |
|---|---|
| **warm-up** | 各反復の最初に 30 秒（5 req/s）を別実行として流し、判定から除外（`warmup.summary.json` は保存するが判定に使わない）。画面は読込 3 回を捨てる |
| **反復** | 各シナリオを 3 回（画面は 10 回）。**毎反復で DB ボリュームを作り直す**（前の反復の件数・断片化・キャッシュを持ち越さない）。反復は直列（約 6 分ずつ） |
| **noise の扱い** | 上位 0.1% の外れ値を除く（performance-09）。`compare.mjs` は +20% 超でも絶対差が下限（ms 5・秒 5・率 0.001）未満なら退行にしない |
| **比較条件** | 同じ `env_class` の baseline とだけ比べる。同じ commit・同じ設定・同じ digest（performance-06）。シナリオの操作列は乱数を使わず決定的 |
| **分散の記録** | `variance_stats`（n・平均・標準偏差・95% 信頼区間。t 分布）を全 run に記録 |

**反復間の分散**（runner、n = 3、[perf-runs.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/perf-runs.json) の `variance_stats`）

| 指標 | 3 反復の値 | 平均 ± 標準偏差 | 95% 信頼区間 |
|---|---|---|---|
| load 一覧 p95 | 19.364 / 19.534 / 19.603 ms | 19.50 ± 0.12（0.6%） | 19.19〜19.81 |
| load 追加 p95 | 18.661 / 18.210 / 18.270 ms | 18.38 ± 0.24 | 17.77〜18.99 |
| load health p95 | 30.814 / 29.492 / 28.779 ms | 29.70 ± 1.03 | 27.13〜32.26 |
| load 一覧 p99 | 49.965 / 40.073 / 53.808 ms | 47.95 ± 7.09（約 15%） | 30.34〜65.55 |
| stress 100 req/s の一覧 p95（膝） | 162.1 / 174.4 / 205.1 ms | 180.5 ± 22.1（約 12%） | 125.6〜235.5 |
| spike の回復時間 | 20 / 15 / 20 秒 | 18.3 ± 2.9 | 11.2〜25.5 |
| capacity 7,500 件の一覧 p95 | 5,144 / 6,069 / 5,151 ms | 5,455 ± 532（約 10%） | 4,133〜6,777 |
| soak 一覧 p95 の前半→後半の変化 | −16.6 / −18.4 / −16.9% | −17.3 ± 0.9 | −19.6〜−15.0 |

- **読み方**: 想定負荷の p95 は信頼区間が狭く、**p99 と、膝・飽和域は揺れる**。n = 3 の信頼区間は広い（t 分布の臨界値 4.30）ので、数 ms の差は有意と見なさない。
- **run 間のノイズについて分かっていること**:
  - **runner**: 同じ run 内の 3 反復は 1% 未満に収まった。**別の run との比較は、runner では 2 本ある**。本計測（タグ v1.0.0、run 38152548008）と、それ以前の試行 run 38141071994（ブランチ `ops/fix-first-runs`、commit `6572173`。Actions のログのみで、結果ファイルは取り込んでいない）。後者は capacity の 7,500 件で一覧 p95 1,555ms（本計測は 5,455ms で**約 3.5 倍**）、画面（1,000 件）p95 125.8ms（本計測 158.1ms）、画面（10,000 件）p95 603.9ms（本計測 583.2ms）。飽和域の値は run 間で大きく動くが、**どちらの run も 5,000 件までは SLO 内で 7,500 件で最初に違反**と、境界は同じだった。commit が別なので厳密な同条件比較ではない。
  - **開発機**: 約 3.5 時間離れた 2 つの run で load の 8 指標が −5〜−8%（削除 p95 のみ −20.7%）と、2 run 間でもミリ秒台の値が約 1〜2ms 動いた。
  - 隣のジョブの影響（共有ランナーの混雑）は観測できない（CPU 使用率は被試験の取り分に対する値で、ホスト全体の混雑は見えない）。
- **できていないこと**: runner の同条件の run を 5 回以上重ねた変動係数と、閾値（+20%）の偽陽性率・偽陰性率の評価。週次の定期実行が貯まってから行う（[ACT-023](data/actions.csv)）。

## performance-08 観測性

**結論**: 負荷中に **CPU・メモリ・health 応答時間・SQLite ファイルサイズ**を 1 秒ごと・UTC タイムスタンプ付きで取り、k6 の最初〜最後の要求を窓にして時刻を整合させている。**APM・queue・外部依存の 3 つは取っていない**。queue と外部依存は**アーキテクチャに存在しない**ため、APM は**未導入**のため。代わりの指標を下表に示す。観測が無いものを「ある」と書かない。

**観測 6 ソースと、存在しない・取っていない理由と代替**（実装: [scripts/perf/observe.mjs](../scripts/perf/observe.mjs)。時刻整合: `analysis.json` の `time_alignment`）

| ソース | 取っているか | 取得方法 / 取っていない理由 | 代わりに取っている指標 |
|---|---|---|---|
| **CPU** | 取っている | `docker stats --no-stream`（backend・frontend・k6 の各コンテナ。k6 側が詰まっていないかの確認用） | — |
| **memory** | 取っている | 同上（開始・終了・最大・増加比・傾き MiB/分） | — |
| **DB** | **一部**（ファイルサイズのみ） | `docker exec` で SQLite のファイルサイズ（`/data/*`。`-journal` を含む）。SQLite は組込みで、**DB サーバー側の待ち時間・クエリ時間・接続数は取れる仕組みが無い**（backend が接続を操作ごとに開き、`node:sqlite` の同期 API でクエリ計測を持たない） | DB ファイルの増加（件数の変化の検出）。DB 時間は、応答時間の件数依存（capacity）と CPU 時間で間接的に見る |
| **APM** | **取っていない（未導入）** | APM エージェント・トレース基盤を導入していない（個人用・本番なしのため）。`perf-runs.json` の `source: apm` は本物の APM ではなく、次の代用の記録 | **health 応答時間と成否の 1 秒間隔のプローブ**（`GET /api/v1/health`、nginx 経由）。backend のイベントループが詰まると health も遅れるため、待ち時間（キューイング）を検出できる。k6 の `http_req_duration`（エンドポイント別）・`dropped_iterations` |
| **queue** | **存在しない** | アーキテクチャに非同期処理・キュー・ジョブが無い（[ADR-0001](adr/0001-frontend-backend-split.md) の構成: nginx + backend + SQLite だけ）。取る対象が無い | 待ち行列に当たるものは、**Node のイベントループの待ち**（health 応答の遅延）、**k6 の取りこぼし（dropped_iterations）**、**nginx の 504（`proxy_read_timeout 30s`）** |
| **外部依存** | **存在しない** | 外部サービス・外部 API・認証基盤を持たない（backend は SQLite のみ。[ai-context.yaml](ai-context.yaml) の `integrations: []`、`environment.yaml` の `mocks: []`）。取る対象も mock も無い | なし（外部依存の遅延は本システムの性能に影響しない。本番で外部依存を足したら取る） |

- **時刻整合の確認**（load 1 反復目、[analysis.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/load/iter-1/analysis.json)）: k6 の窓 2026-10-11T15:46:02.303Z〜15:51:02.254Z（300 秒）に対し、docker stats のサンプルは 896（3 サービス）、1 秒あたり 0.996 サンプル。`docker stats --no-stream` は 1 回に約 1 秒かかるため、tick を重ねて 1 秒間隔を保つ。窓の外（warm-up・後片付け）は要約から除く。段・フェーズごとの突き合わせは `scripts/perf/stage-report.mjs`。
- **観測できた例**（load 1 反復目）: backend CPU 平均 36.2%・p95 57.5%・最大 67.9%、frontend CPU 平均 2.1%、k6 CPU 平均 11.4%、backend メモリ 39.2 → 40.1 MiB（最大 58.1 MiB）、health 299 回すべて成功（p95 30.8ms）、DB 155,648 → 389,120 bytes（件数増による）。
- **観測の弱さ（正直に）**: ①アプリ内の処理時間（ハンドラ・クエリ・JSON 化）が分解できず、**原因の絞り込みはコードを読んだ仮説と比較実験（E0〜E3）に頼った**（performance-10）。②イベントループ遅延を直接計測していない（health の遅延で代用）。③ホスト全体の混雑（共有 runner のノイジーネイバー）は見えない。④nginx のアクセスログ・上流応答時間は集めていない。⑤画面計測（screen）はサーバー側の観測を並走させていない。APM 導入の要否は [ACT-025](data/actions.csv)。

## performance-09 判定方法

**結論**: 判定規則を**コードとして文書化**し（[scripts/perf/lib/rules.mjs](../scripts/perf/lib/rules.mjs)・`rules-scenarios.mjs`）、`verdict.mjs` が全 run を自動で判定する。平均のみで判定せず、p95（SLO にあるものは p99）で判定し、エラーは除外せず失敗として数える。規則は全 run の `verdict_rule` に同じ文面で記録される（本計測の 6 run で一致）。

| 項目 | 規則（`verdict.json` の `verdict_rule`） |
|---|---|
| **統計量** | p95（SLO にあるものは p99）。エラーは rate、スループットは目標到着率に対する達成率。**平均のみでは判定しない**。パーセンタイルは k6 と同じ線形補間 |
| **外れ値** | warm-up 30 秒は別実行として除外。seed / setup の要求を除外。各エンドポイントの応答時間は**上位 0.1%（n ≥ 100 のとき ceil）を除いて** p95 / p99 を求め、除外前の値は `raw_p95`・`raw_p99`・`raw_p999` に併記。エラーになった要求は除外しない |
| **エラー** | エラー率 = max(`http_req_failed` の率, `checks` 失敗率) < 1%。k6 側で期待どおりでない status と契約違反（Task の主要項目・createdAt の降順）も失敗に数える。5xx・接続失敗・応答検証の失敗を含み、想定された 4xx は除く |
| **SLO 違反** | 判定値 = 3 反復の平均。平均が `slo.yaml` の target を満たさなければ **fail**。反復のいずれか、または 95% 信頼区間の悪い側の端が満たさなければ **warning を残す**（pass のまま） |
| **capacity の範囲** | SLO の適用範囲（1,000 件）の違反は fail。それを超える件数の違反は警告（容量計画の指標。`max_tasks_within_slo` に記録） |
| **spike の回復** | 5 秒区間の推移から、以降ずっと SLO 内に戻る最初の区間を求める。30 秒以内に回復し、回復期の末尾 30 秒も SLO 内であること |
| **soak** | 前半 2 分 → 後半 2 分の一覧 p95 の悪化 ≤ +20%、メモリ増加比 +20% で警告・+50% で fail |
| **退行** | `compare.mjs`。同じ指標名・同じ環境の区分の baseline と比べ、+20% 超の悪化で失敗（performance-12） |
| **k6 の threshold** | 早期警告のみ（abortOnFail なし）。合否の正本は `verdict.mjs`（外れ値除外・3 反復の平均・信頼区間を持つため）。k6 の終了コード 99 は試験結果として扱い、run.sh は止まらない |

- **規則が試験の不備を拾った実例**: soak が最初 fail した（一覧 p95 が前半→後半で +25.8%）のは、時間による劣化ではなく、**試験側の不備で件数が増えていた**ため。同じ規則が「件数の増加による劣化」を検出した。fail の記録は削除せず残してある（[perf/analysis.md](../perf/analysis.md) §4・§6）。
- **自動判定の検証**: 単体テスト 17 件（percentile の線形補間・外れ値除外・平均 vs 反復・退行・ノイズ除け・環境区分・spike の回復・capacity の範囲）が pass。実 run の判定は verdict.json（本計測: 全体 pass、警告 2 件はいずれも capacity の範囲外の件数）。
- **規則の限界**: 画面計測の n は 10 で p95 の信頼度は低い。反復 3 回の信頼区間は広い。外れ値の除外 0.1% は経験則で、統計的に導いた値ではない。

## performance-10 ボトルネック分析

**結論**: 遅くなる**症状**と、その**原因**を分けて特定した。原因は「backend が毎要求で接続を開き、書込みでも全行を読んで検証してから 1 行を操作する設計（コストが件数 N に比例）を、Node の単一スレッドで同期処理（`DatabaseSync`）している」こと。**飽和する資源は backend の CPU（1 vCPU）**、**待ち時間の正体は Node のイベントループの待ち（キューイング）**。観測データと 3 つの比較実験で裏付け、改善案と効果の見込み（推定）を残した。出典: [perf/analysis.md](../perf/analysis.md) §2、Issue #31。

### 症状（利用者・試験者に見えたこと）

1. 到着率が約 150 req/s を超えると応答が急増し（p95 数秒〜十数秒）、nginx の 504（`proxy_read_timeout 30s` に達した要求）が出る。runner では 200 req/s で p95 約 15 秒・エラー 45%（[stress/verdict.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/stress/verdict.json)）。
2. その間、**health の応答も 2〜4.7 秒に伸びる**（開発機）。health は DB を開くだけで軽いので、要求の種類に関係なく**待たされている**。
3. 高負荷の後も k6 の取りこぼし（dropped iterations）が出る（spike で runner 平均 16,465 件）。
4. 件数が増えると、同じ到着率でも CPU 使用率が上がる（開発機で 10,000 件・20 req/s で CPU 71%。runner では 7,500 件で 17.1 req/s、10,000 件で 12.6 req/s しか捌けない）。

### 飽和している資源と待ち時間（観測データによる裏付け）

| 段（req/s） | 達成 req/s | 5xx | backend CPU 平均 / 最大（%） | frontend CPU（%） | k6 CPU（%） | backend メモリ最大（MiB） | health p50 / p95 / 最大（ms） |
|---|---|---|---|---|---|---|---|
| 20 | 20 | 0 | 14.2 / 21.9 | 1.2 | 5.4 | 51.6 | 7.1 / 14.2 / 19.1 |
| 50 | 50 | 0 | 30.6 / 41.7 | 1.7 | 10.4 | 51.5 | 6.4 / 11.8 / 15.2 |
| 100 | 100 | 0 | 76.8 / 96.8 | 3.1 | 23.2 | 57.9 | 7.6 / 32.5 / 117.9 |
| 200 | 121.9 | 4,613 | 97.6 / 101.5 | 4.5 | 34.9 | 86.8 | 3,266 / 4,704 / 4,838 |
| 400 | 124.2 | 6,248 | 98.9 / 101.0 | 4.2 | 34.8 | 92.5 | （サンプルなし） |
| 800 | 142.8 | 5,810 | 98.7 / 102.0 | 3.7 | 33.9 | 95.3 | 2,047 / 3,623 / 3,765 |

（開発機・3 反復の平均。`perf/results/20261011T082949Z-f948648/stress/stage-resources.json`。`stage-report.mjs` が 1 秒間隔の観測と k6 の段を時刻で突き合わせた表。runner では stress 全期間で backend CPU 平均 77%・p95 104%、frontend 5% 台、k6 CPU p95 82〜92% で、飽和資源は同じく backend の CPU。[perf/analysis.md](../perf/analysis.md) §8.2）

- **飽和資源は backend の CPU（1 vCPU の上限）**。100 req/s で CPU 77%、150 req/s 以上で 98〜102% に張り付く。frontend（nginx）は 5% 以下、k6 は開発機で 35% 以下で、**どちらも律速ではない**（runner では k6 が 1 コア近くを使うため、高負荷段に負荷生成側の飽和が混ざる可能性が残る。performance-04）。メモリは 95 MiB（上限 512 MiB）で増え続けていない。
- **待ち時間の正体は、Node の単一スレッドのイベントループの待ち**。CPU が 100% に張り付いた段で health が 2〜4.7 秒に伸びる。health 自体は軽いので、他の要求の処理が終わるまで順番を待っている（キューイング）。最終的に nginx が 30 秒で 504 を返す。
- **1 要求あたりの CPU 時間は約 6〜10 ms**（開発機。CPU% ÷ 到着率）。1 vCPU が 100% になる到着率は約 100〜150 req/s で、観測した崩れ始めと一致する。runner は 1 要求の CPU 時間が開発機の約 1.7 倍（20 req/s で backend CPU 平均 36% vs 21%）。

### 原因の仮説と検証（比較実験。各 1 反復で、方向と大きさの目安）

| # | 仮説 | 検証 | 結果 |
|---|---|---|---|
| H1 | backend が CPU 律速（単一スレッド）。CPU 上限を増やしても飽和点は大きく動かない | E2: `cpus: 2.0` | **支持**。限界点は 100→150 req/s に上がっただけ（+50%）。メインスレッドは 100% に張り付き、増えた分は GC・libuv のスレッド |
| H2 | 1 要求の仕事量が件数 N に比例する（一覧は全件を JSON 化、書込みも毎回「全行を読んで検証」する `sqlite-store.js` の `readAll`） | capacity（件数別 p95）と E3（10,000 件で stress） | **強く支持**。list p95 は 1,000→10,000 件で 9.4→29.7ms（開発機。約 +2.3ms / 1,000 件）。E3 では 10,000 件・20 req/s で CPU 71%（1 要求 約 31ms）、限界点が約 30 req/s まで下がる |
| H3 | リクエストログ（pino の info を 1 要求 2 行）が CPU を食っている | E1: `LOG_LEVEL=silent` | **ほぼ棄却**。100 req/s で CPU 63.5%→65.7%（差なし）。飽和は変わらない |
| H4 | nginx の中継（`proxy_pass`、gzip）が律速 | 段表の frontend CPU | **棄却**（5% 以下） |
| H5 | 書込みの fsync（journal_mode=DELETE）が律速 | load の create p95 と list p95 の差が約 1ms | **現時点では主因ではない**。高負荷での fsync の効きは未分離（実験していない） |
| H6 | 操作ごとの接続オープン + マイグレーション確認の固定費が大きい | 未検証 | **未検証**。2 点の線形近似（切片 約 3ms）に過ぎない |

### 結論（症状と原因の対応）と改善案

- **原因**: backend が毎要求で「接続を開く → 全行を読んで検証 → 操作」を同期 API で行い、コストが件数に比例し、Node の単一スレッドで直列に処理される。CPU 上限で飽和し、飽和後は待ち行列がそのまま遅延と 504 になる。
- **症状**: 限界（約 100〜150 req/s、10,000 件の開発機では約 30 req/s、runner では 7,500 件で 20 req/s を捌けない）を超えると遅延・エラー。health まで遅れる。
- 想定利用（0.5 req/s）では 2 桁以上の余裕があり、**現状で利用者に影響する問題は無い**。将来の件数増加と、複数クライアント・自動化・再試行が重なるときのための余裕を測った結果として、次を残した（**いずれも未実装。見込みは推定で実測ではない**）。

| 案 | 内容 | 効果の見込み（推定） | 契約への影響 |
|---|---|---|---|
| A | 書込みで全行を読まず `WHERE id = ?` の 1 行操作にする | 書込みが件数に依らず O(1)。load の比率（書込み 40%）なら全体の CPU は 1,000 件で約 3 割減、10,000 件で約 6 割減（一覧の O(N) は残る） | なし |
| B | 接続を常駐、prepared statement | 固定費（H6）の削減。効果は未測定。運用操作を再起動なしで効かせる設計意図とのトレードオフ | なし |
| C | 一覧のページング、または画面の仮想スクロール | 10,000 件での転送量（約 300 KB）・描画・JSON 化の CPU を抑える | **あり**（UNK-002 の決定と合わせる） |
| D | nginx で過負荷時に速く失敗させる（`limit_req`・上流タイムアウト短縮） | 容量は増えないが、利用者が 30 秒待たされるのを防ぐ | なし（429・503 は契約に書く） |
| E | CPU 上限を上げる | E2 のとおり 2 vCPU で +50% 止まり。複数プロセスは SQLite の単一ファイルでは書込みが競合する | なし |

改善は [ACT-006](data/actions.csv)（バックエンド担当・期限 2026-12-31。案 A を実施し perf.yml の `compare.mjs` で確かめる）、不具合は Issue #31（minor・未修正・OPEN。期限 2026-12-31）。

## performance-11 容量・Headroom

**結論**: 1,000 件で、runner の CPU でも想定ピーク 0.5 req/s の **100 倍（50 req/s）まで p95 18.4ms**、**200 倍（100 req/s）が膝**（p95 180ms）で、200 req/s で崩れる。限界は**件数**にも強く依存し、runner の CPU では **5,000 件を超えると 20 req/s（想定ピークの 40 倍）を保てない**。水平スケールは SQLite の単一ファイルのためできない。

| 項目 | 内容（出典: [perf/analysis.md](../perf/analysis.md) §3・§8.2、[stress/verdict.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/stress/verdict.json)、[capacity/verdict.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/capacity/verdict.json)） |
|---|---|
| **限界点（1,000 件）** | runner: `max_sustained_rps` = **100**、3 反復とも **200 req/s で最初の違反**（list p95 約 15 秒・エラー 45%）。開発機: 約 100〜150 req/s。飽和資源は backend の CPU 100% |
| **限界点（件数）** | runner（20 req/s）: `max_tasks_within_slo` = **5,000 件**（list p95 184.8ms）。**7,500 件で 5,455ms、10,000 件で 7,876ms**。7,500 件で達成 17.1 req/s、10,000 件で 12.6 req/s（取りこぼし）。開発機: 10,000 件でも SLO 内（list p95 29.7ms）。開発機の 10,000 件での限界点（stress 1 反復）は約 30 req/s |
| **安全余裕** | 想定ピーク 0.5 req/s に対し、runner の 1,000 件で **100 倍（50 req/s）まで p95 18.4ms**、200 倍（100 req/s）が膝。運用の目安は backend CPU 50% 以下（開発機で 1,000 件の約 50〜75 req/s）。件数が増えると余裕は縮む（runner の 5,000 件は 20 req/s で既に list p95 184.8ms） |
| **スケール条件**（対応を始める合図） | (1) backend CPU p95 が 70% を 5 分以上、(2) health p95 > 200ms（SLO）、(3) 一覧 p95 > 300ms（SLO 500ms の 60%）、(4) タスク件数 > 5,000。対応の順は A（書込みの O(1) 化）→ C（ページング）→ B。**CPU の引き上げ（E）は効果が小さく、水平スケールは SQLite の単一ファイルのため不可**（DB を替える設計変更が要る） |
| **コスト** | 本リポジトリに運用費は無い（本番が無い）。試験は GitHub Actions（公開リポジトリは無料）とローカル（perf.yml は 1 回約 2 時間 23 分、週次）。想定本番の小さな VM（1 vCPU・1 GiB）で足りる（backend のメモリは 40〜60 MiB）。CPU 上限を 2 vCPU にしても容量は +50% なので、**コストを足して得られる容量は小さい** |

**成長予測に対する容量計画**（成長: +20 件/日。[perf/workload.yaml](../perf/workload.yaml) の `growth`）

| 時点 | 件数 | runner 相当の CPU で 20 req/s（想定ピークの 40 倍）を保てるか | 想定ピーク 0.5 req/s では |
|---|---|---|---|
| 現状 | 1,000 | 保てる（list p95 13.0ms） | 余裕（実測は 20 req/s のみ） |
| 約 250 日後 | 5,000 | 保てる最後の件数（list p95 184.8ms） | 余裕 |
| 1 年後（最悪ケース） | 7,300 | **保てない**（7,500 件で 5,455ms・17.1 req/s） | 推定で余裕（下記） |
| 約 500 日後 | 10,000 | **保てない**（7,876ms・12.6 req/s） | 推定で余裕（下記） |

- **推定（未測定）**: runner の 10,000 件は CPU 飽和で 12.6 req/s を捌いたので、1 要求の CPU 時間は約 80ms（1 ÷ 12.6）。想定ピーク 0.5 req/s なら CPU 使用率は約 4% で、待ち行列は出ない見込み。**0.5 req/s での件数別の実測はしていない**（capacity は 20 req/s のみ）。
- 「保てない」のは**想定ピークの 40 倍の負荷**を前提にした場合で、想定どおりの利用（0.5 req/s）で利用者が困るという意味ではない。20 req/s は複数端末・自動化・再試行の余裕分の負荷。それが現実になる前に改善案 A・C を入れる（ACT-006）。件数の上限が決まれば（UNK-002）、容量計画を更新する。
- 容量計画の限界: 本番の CPU は不明で、開発機と runner は**上下の目安**（本番は 2 つの間、またはそれより遅い可能性）。限界点・飽和する件数は CPU の速さに強く依存し、倍率は一定でない（1,000 件で 1.3〜1.8 倍、飽和域では桁が変わる）。

## performance-12 Baseline・Trend

**結論**: baseline と退行の閾値を持ち、`compare.mjs` が**同じ環境の区分の run 同士**で自動比較する（perf.yml・run.sh に組み込み済み。退行があれば終了コード 1 でジョブ失敗）。baseline は開発機（`initial-main-6e5d2db`）と runner（`v1.0.0`）の 2 区分。**ただし trend（傾向）は言えない**（各区分の run が 1 つで、runner の baseline は 1 回の run から作った）。

| 項目 | 内容 |
|---|---|
| **baseline** | [perf/baseline.json](../perf/baseline.json): `initial-main-6e5d2db`（開発機 `local:darwin-arm64`、commit `f948648`、run `20261011T082949Z-f948648`、soak のみ `soak-r2-…`。指標 27 件）、`v1.0.0`（runner `github-hosted:ubuntu24:X64`、commit `5fcf40a`、run `gha-38152548008-5fcf40a`。指標 27 件）。PR #61 で runner を追加 |
| **比較できる指標** | 同じ指標名（`<シナリオ>.<指標>`。例 `load.api_list_p95_ms`・`stress.max_sustained_rps`・`capacity.max_tasks_within_slo`・`screen.screen_ready_ms`） |
| **退行の閾値** | [perf/regression-threshold.yaml](../perf/regression-threshold.yaml): 既定 **+20% 超の悪化で退行**（大きいほど良い指標は符号を反転）。ノイズ除け `min_abs_delta`（ms 5・秒 5・率 0.001） |
| **自動化** | perf.yml の `run.sh` が最後に `compare.mjs` を実行し、退行があればジョブ失敗。step summary に基準・比較指標数・退行を出す |
| **動かす契機** | 手動・週次（月曜 03:17 UTC）・release.yml からの `workflow_call`（現状 release.yml は最新の成功 run の結果を**添付するだけ**）。**PR ごとには動かない**（ADR-0005 の限界） |
| **更新ルール** | release ごとに perf.yml を実行し、`compare.mjs --update-baseline --release <タグ>` で baseline に追記して PR で差分を確認。閾値の見直しは偽陽性が続いたとき |

**退行検出の確かめ**（実際の退行ではなく、動作の確認）

- 開発機: 基準の ms 指標を半分にした疑似 baseline と比べ、追加・更新・health の 3 指標が +88〜90% 悪化として検出され、終了コード 1 になることを確認した。load だけの再実行 `load-compare-20261011T115828Z-191a25b` は baseline 比で退行 0 件（8 指標）。
- runner: 本計測の run 自体は baseline が無く「比較せず」（[compare.json](evidence/perf/perf-results-38152548008/gha-38152548008-5fcf40a/compare.json)）。baseline `v1.0.0` を追加した後は、**同じ run を比べているので退行 0 件が自明**で、runner での最初の意味のある比較は**次の run**。

**環境の区分を越えた比較は退行とみなさない**。runner は開発機より p95 で 1.3〜1.8 倍、p99 で約 4 倍遅く（一覧 p95 19.5 vs 10.6ms、p99 47.9 vs 11.7ms）、これは退行ではなく環境の差。

**trend の限界**: 同じ区分の run が 1 つなので、「前版より遅くなったか」は**まだ判定できない**（v1.0.0 が初回リリース）。perf.yml の定期実行（schedule）の履歴も 0 件（`gh api repos/bsj-fujimoto/todo-app/actions/workflows/perf.yml/runs?event=schedule` の total_count = 0、2026-10-12 08:07 UTC 時点。同日 03:17 UTC の週次の枠でも実行は無い。GitHub の cron は遅延・欠落しうる）。`gh run list --workflow perf.yml` の 4 件はすべて手動実行〔workflow_dispatch〕: 成功 1・失敗 2・取消 1。失敗は k6 の出力権限〔PR #39 で修正〕と capacity の判定の範囲〔その後、SLO の適用範囲外は警告に変更〕による。取消の 1 件は理由を確認していない。定期実行の確認は [ACT-013](data/actions.csv)、runner のノイズと閾値の評価は [ACT-023](data/actions.csv)、PR での早期検出は [ACT-026](data/actions.csv)。

## performance-13 外挿の限界・残存リスク

**結論**: この結果を本番に**そのまま当てはめてはならない**。本番も実測ログも無く、ワークロードは想定、CPU の速さは本番と揃っておらず、TLS・実ネットワーク・長時間・複数利用者を含まない。確かなのは「**同じ環境の区分での相対比較**（退行・件数の傾き・飽和の仕方）」と「**想定負荷（想定ピークの 40 倍）で SLO を満たす**」ことまで。下に、一般化できない点と、残存リスクごとの監視指標・閾値・対応を決めた。

### 本番へ一般化できない点

| 点 | 何が言えないか | 影響の向き |
|---|---|---|
| **本番・実測ログが無い** | 想定ピーク 0.5 req/s・1 日 100 操作・安全率 40 は想定。朝昼夕の集中などの実利用分布は再現していない。実利用が別なら前提が崩れる | 不明 |
| **CPU の速さ** | 限界点（req/s）・飽和する件数は CPU に強く依存する。開発機と runner は 1.3〜1.8 倍（飽和域では桁）違う。本番の CPU は不明 | 本番は低い可能性 |
| **共有ランナーのノイズ** | runner は 1 回の run から。run 間の揺れは不明。飽和域の run 間では約 3.5 倍動いた例がある（performance-07） | 不明（飽和域ほど不確か） |
| **同一ホストの負荷生成** | runner では k6 が 4 vCPU を共有し、高負荷段（stress・spike）に負荷生成側の飽和が混ざりうる | 限界点を低く見積もる |
| **TLS・実ネットワークが無い** | 本番の体感（表示完了 158ms など）は TLS ハンドシェイクと遅延の分だけ遅い（未測定） | 本番は遅い |
| **件数・タイトルの分布** | 連番・短いタイトル（11 文字前後）。実利用の長いタイトルは一覧のレスポンス（JSON 化の CPU）が増える | 本番は遅い |
| **コールドスタート・初回アクセス** | warm-up 後の値。再起動直後・初回の遅さは測っていない | 本番は遅い |
| **長時間** | soak は 10 分。メモリのゆるやかな増加・断片化は 10 分では見えない | 不明 |
| **並行する複数利用者** | 1 人用。複数クライアントの競合（SQLite の書込みロック、`busy_timeout` 2 秒）は stress の同時書込みでしか見ていない | 不明 |
| **観測の範囲** | APM が無く、アプリ内の処理時間・イベントループ遅延は直接見ていない | 原因特定が間接的 |
| **想定ピークでの件数依存** | capacity は 20 req/s のみ。0.5 req/s での件数別の実測は無い | 推定のみ |

### 残存リスクと監視指標・閾値・対応

| リスク | 監視する指標（どこで見るか） | 閾値 | 対応 |
|---|---|---|---|
| 件数増加による一覧・書込みの劣化（O(N)。Issue #31） | 週次 perf.yml の capacity の一覧 p95、外形監視 MON-003（追加）の応答時間。件数そのもの（タスク件数） | 一覧 p95 > 300ms（SLO の 60%）、MON-003 の応答 > 150ms が続く、**件数 > 5,000** | 改善案 A → C（ACT-006）。件数上限（UNK-002）を決める |
| CPU 飽和（複数クライアント・再試行の重なり） | 負荷中の backend CPU（`observe.mjs`）、health p95（`slo.yaml` health_p95_ms）、MON-002 の応答 | backend CPU p95 > 70% を 5 分、health p95 > 200ms | 負荷源の特定。改善案 A・D |
| 過負荷時の 504（30 秒待ち） | spike の回復時間、5xx 率、k6 の取りこぼし | 回復 30 秒超、エラー率 > 1% | 改善案 D（早く失敗させる） |
| コードの変更による遅延（退行） | `compare.mjs`（baseline 比） | +20% 超かつ絶対差が下限（ms 5・秒 5・率 0.001）以上 | PR を差し戻す。baseline は release ごとに更新。PR で動かない点は ACT-026 |
| メモリ・DB サイズの増加（長時間） | soak のメモリ増加比、DB ファイルサイズ（`observe.mjs` db）。10 分版は増加比 1.04〜1.08 | メモリ +20% で警告、+50% で失敗 | 長時間版 soak（`SOAK_DURATION_SEC=7200`）を実施（ACT-024） |
| 実環境（runner・本番）との差 | runner の perf.yml の実測（baseline `v1.0.0`）。本番を持ったら本番の応答時間・CPU | 同じ環境の区分で baseline 比 +20% | 区分ごとに baseline を持つ。本番を持ったら `workload.yaml` を実測に置換（ACT-025） |
| 想定ワークロードの前提が崩れる | 実利用の件数・操作数（本番を持ったら要求数のログ） | 想定ピーク 0.5 req/s を超える、または 1 日 100 操作を超える | 想定を実測に置換し、SLO・安全率を見直す |
| 定期実行が止まる（劣化に気づけない） | perf.yml・synthetic.yml の schedule 実行の有無 | 週次実行が 2 週続けて無い | ACT-013（定期実行の確認）、RB-005 |

- **「本番でも問題ない」とは書かない**。確かなのは上記の範囲まで。想定利用（0.5 req/s）で現状に利用者への影響は無い見込みだが、それは**想定と相対比較に基づく**。
- 本番を持つとき（または実利用のログが得られたとき）は、`workload.yaml` の想定値を実測に置換し、`perf/baseline.json` を更新し、本書を改版する。

## できていないこと・アクション

| 項目 | 内容 | 追跡 |
|---|---|---|
| runner の run 間ノイズと閾値の評価 | runner の同条件の run が 1 つ（+ 参考の試行 1 つ）。定期実行（週次）が貯まるまで、変動係数と閾値 +20% の偽陽性率・偽陰性率は評価できない | [ACT-023](data/actions.csv)・[ACT-013](data/actions.csv) |
| 長時間 soak | 10 分版のみ。2 時間以上は未実施 | [ACT-024](data/actions.csv) |
| 観測の拡張（APM・イベントループ遅延） | health の遅延で代用している。導入するかの判断が未決 | [ACT-025](data/actions.csv) |
| PR での性能退行の早期検出 | perf は週次・手動・リリース前で、PR ごとには動かない。番兵（TC-073・074）は 3 倍のしきい値で小さな退行を見逃す | [ACT-026](data/actions.csv) |
| backend の性能改善（件数比例のコスト） | 改善案 A〜E は未実装 | [ACT-006](data/actions.csv)・Issue #31 |
| 件数上限・想定の実測化 | 件数の上限が未決。本番・実測ログなし | [UNK-002](data/unknowns.csv) |

## 出典

- 仕様・SLO・想定: [perf/slo.yaml](../perf/slo.yaml)、[perf/workload.yaml](../perf/workload.yaml)、[perf/environment.yaml](../perf/environment.yaml)、[perf/environment.md](../perf/environment.md)、[perf/analysis.md](../perf/analysis.md)、[perf/README.md](../perf/README.md)
- 設定・実装: [perf/baseline.json](../perf/baseline.json)、[perf/regression-threshold.yaml](../perf/regression-threshold.yaml)、[perf/compose.perf.yml](../perf/compose.perf.yml)、`perf/k6/`・`perf/screen/`、`scripts/perf/`（run.sh・verdict.mjs・compare.mjs・observe.mjs）、[.github/workflows/perf.yml](../.github/workflows/perf.yml)
- 実測: 本計測 = [docs/evidence/perf/](evidence/perf/SOURCE.json)（run 38152548008、タグ v1.0.0・commit 5fcf40a7…。`verdict.json`・`perf-runs.json`・`metrics.json`・各 `analysis.json`・`screen/`）、開発機 = [perf/results/](../perf/results/)（run `20261011T082949Z-f948648`・実験 E0〜E3・soak 再実験・`load-compare-…`）
- 関連: Issue #31（件数比例のコスト。runner の capacity データのコメントあり）、[ADR-0005](adr/0005-functional-layer-perf-sentinel.md)、[TC-073・TC-074](data/cases.csv)、[ACT-006・009・013・023〜026](data/actions.csv)、[UNK-002](data/unknowns.csv)、[11 外形監視](11-monitoring.md)
