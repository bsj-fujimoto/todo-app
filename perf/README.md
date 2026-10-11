# 負荷・性能試験

ToDo アプリ（frontend nginx:8080 + backend Fastify / SQLite、docker compose）の負荷・性能試験。k6（Docker イメージ、digest 固定）で API を、
Playwright + Lighthouse（Docker イメージ）で画面の表示完了時間を測る。**実際に動かし、実測値を `perf/results/` に保存**し、再現できる形にしている。

- SLO（機械可読）: [`slo.yaml`](slo.yaml)　- ワークロードモデル: [`workload.yaml`](workload.yaml)（**実測ではなく想定**）
- 測定環境: [`environment.md`](environment.md)（人が読む説明）・[`environment.yaml`](environment.yaml)（本番との差異の機械可読版）
- ボトルネック分析・容量・外挿の限界: [`analysis.md`](analysis.md)　- 結果: [`results/`](results/)　- ベースライン: [`baseline.json`](baseline.json)
- 退行の閾値: [`regression-threshold.yaml`](regression-threshold.yaml)（既定 +20%）

## 試験の種類（選定理由は workload.yaml の `scenarios`）

| 種別       | スクリプト                                                   | 内容                                                                                                                   | 判定                                                                                                        |
| ---------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| ① load     | `k6/load.js`                                                 | 想定負荷 20 req/s（想定ピーク 0.5 req/s の 40 倍）を 5 分。操作比率 一覧 60 / 追加 25 / 完了切替 10 / 削除 5           | **SLO を判定**（p95・p99・error・throughput・health）                                                       |
| ② stress   | `k6/stress.js`                                               | 20 → 50 → 100 → 200 → 400 → 800 req/s を段階的に（各段 5 秒で到達 → 60 秒保持）                                        | 限界点（最初に SLO・エラー・取りこぼしを割る到着率）を求める。SLO の合否は判定しない                        |
| ③ spike    | `k6/spike.js`                                                | 20 → 400 req/s を 10 秒で跳ね上げ 60 秒保持 → 20 に戻し、回復を見る                                                    | 戻ってから 30 秒以内に list p95 が SLO 内・error < 1% に戻り（5 秒区間の推移）、回復期の末尾 30 秒も SLO 内 |
| ④ soak     | `k6/soak.js`                                                 | 想定負荷で長く流す。CI 短縮版 10 分（`SOAK_DURATION_SEC` で長時間版）。件数一定（追加=削除）で時間劣化だけを見る       | error < 1%・p95 が SLO 内・前半→後半の悪化 ≤ +20%・メモリ増加（+20% で警告、+50% で fail）                  |
| ⑤ capacity | `k6/capacity-step.js`（件数を `seed.js` で増やして繰り返す） | 件数 1,000 → 2,500 → 5,000 → 7,500 → 10,000 で想定負荷を 60 秒ずつ                                                     | 各件数で SLO 内か。SLO 内の最大件数を `max_tasks_within_slo` に                                             |
| 画面       | `screen/measure.mjs`                                         | TC-074: 1,000 行が描画されるまで（キャッシュなし・10 回）と Lighthouse（performance / accessibility）。10,000 件も観測 | 表示完了 p95 ≤ 2,000ms                                                                                      |

TC-073（API 一覧 1,000 件）は load の `list`・`create`、TC-074（画面表示完了）は画面計測が対応する。データ投入は API 経由（`k6/seed.js`、DS-006）。

## 実行方法（Docker / mise 経由）

リポジトリのルートで。ホストに k6・Lighthouse を入れない（Docker イメージを digest 固定で使う）。Node は mise。

```sh
mise x -- npm ci                                   # yaml だけ（判定スクリプトの依存）
scripts/perf/run.sh --profile ci                   # 全部（3 反復・約 2 時間）。結果は perf/results/<run_id>/
scripts/perf/run.sh --profile quick --scenarios load --iterations 3   # 動作確認（60 秒 × 3）
SOAK_DURATION_SEC=7200 scripts/perf/run.sh --scenarios soak            # 長時間 soak（2 時間 × 3 反復）
```

`run.sh` の流れ: compose 起動（毎反復で DB ボリュームを作り直す）→ DS-006 を API で投入 → **warm-up 30 秒（判定から除外）** → 観測サンプラーを並走して k6 実行 →
**3 反復** → `verdict.mjs`（判定）→ `record.mjs`（記録・sha256）→ `compare.mjs`（baseline との退行検出）。`run_id` は `UTC 日時-commit SHA7桁`。
終了コード: 0 = 全 pass かつ退行なし、1 = fail または退行、2 = 実行の失敗。

個別のスクリプト:

```sh
mise x -- node scripts/perf/verdict.mjs --run-dir perf/results/<run_id>   # 判定を出し直す（verdict.json）
mise x -- node scripts/perf/record.mjs  --run-dir perf/results/<run_id>   # metrics.json / perf-runs.json / manifest.json
mise x -- node scripts/perf/compare.mjs --run-dir perf/results/<run_id>   # 退行検出
mise x -- node scripts/perf/compare.mjs --run-dir perf/results/<run_id> --update-baseline --release <タグ>   # baseline に追記
mise x -- node --test "scripts/perf/test/*.test.mjs"                       # 判定ロジックの単体テスト
```

## 結果ディレクトリの構成（`perf/results/<run_id>/`）

| ファイル                                                                        | 内容                                                                                                                  | コミット                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `run.json`                                                                      | 測定環境（OS・CPU・メモリ・Docker・k6 の版、イメージ、commit、script / 設定の sha256、env_class、開始時刻）           | する                                                  |
| `<scenario>/iter-N/main.summary.json`（capacity は `step-<件数>.summary.json`） | k6 `handleSummary` の JSON（thresholds・metrics・計測窓）                                                             | する                                                  |
| `<scenario>/iter-N/analysis.json`                                               | 判定用の統計（エンドポイント別 p50/p90/p95/p99・外れ値除外前後・error・throughput・グループ別）と観測の要約・時刻整合 | する                                                  |
| `<scenario>/iter-N/*.raw.json.gz`, `observe.jsonl`                              | k6 の生出力 / 観測サンプラーの生ログ（巨大）                                                                          | **しない**（`.gitignore`。sha256 は `manifest.json`） |
| `<scenario>/verdict.json`                                                       | シナリオの判定（pass/fail・理由・警告・`variance_stats`）                                                             | する                                                  |
| `screen/screen.json`                                                            | 表示完了 10 回・Lighthouse 3 回の値                                                                                   | する                                                  |
| `verdict.json`                                                                  | 全体の判定と判定規則（`verdict_rule`）                                                                                | する                                                  |
| `metrics.json`                                                                  | baseline 比較に使う指標（`<scenario>.<指標>`）                                                                        | する                                                  |
| `perf-runs.json`                                                                | シナリオごとの記録（tool・版・script / 設定の sha・commit・warm-up・反復・分散・判定規則・server_metrics・verdict）   | する                                                  |
| `compare.json`                                                                  | baseline との比較                                                                                                     | する                                                  |
| `manifest.json`                                                                 | 全ファイルの sha256（生ログも含む）と、コミット対象か                                                                 | する                                                  |

## 判定規則（`scripts/perf/lib/rules.mjs` に文書化したコードとして）

- **統計量**: p95（SLO にあるものは p99）。平均のみで判定しない。パーセンタイルは k6 と同じ線形補間。
- **外れ値**: warm-up 30 秒は別実行として除外。seed / setup の要求を除外。各エンドポイントの応答時間は**上位 0.1%（n ≥ 100 のとき ceil）を除いて** p95 / p99 を求める。除外前の値は `raw_p95` などに併記。
- **エラー**: エラー率 = max(`http_req_failed` の率, `checks` 失敗率) < 1%。k6 側で期待どおりでない status・契約違反（Task の主要項目・createdAt の降順）を失敗に数える。
- **SLO 違反**: 判定値 = 3 反復の平均。平均が `slo.yaml` の target を満たさなければ fail。反復の 1 つでも、または 95% 信頼区間の悪い側の端が満たさなければ warning を残す（pass のまま）。
- **ばらつき**: 3 反復の平均・標準偏差・95% 信頼区間（t 分布）を `variance_stats` に出す。
- **退行**: `compare.mjs`。同じ指標名・同じ環境の区分（`env_class`）の baseline と比べ、既定 +20% 超の悪化で失敗。数 ms の差などノイズは `min_abs_delta` で除く。

## 観測（`scripts/perf/observe.mjs`）

負荷中に 1 秒ごと、**UTC のタイムスタンプ付き**で JSONL に追記する。k6 の最初〜最後の要求（生出力の時刻）を窓にして整合させ、窓の外（warm-up・後片付け）は要約から除く。

| ソース       | 取得方法                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| cpu / memory | `docker stats --no-stream`（backend・frontend・k6 コンテナ。k6 側が詰まっていないかの確認用）           |
| apm 相当     | `GET /api/v1/health` の応答時間と成否（nginx 経由）。backend のイベントループが詰まると health も遅れる |
| db           | `docker exec` で SQLite のファイルサイズ（`/data/*`。`-journal` を含む）                                |

queue・外部依存は**無い**ため取得していない（SQLite は同期処理で、外部サービスは持たない）。

## 設計判断

1. **オープンモデル（到着率固定）**で負荷をかける。応答が遅くなっても到着は減らないので、飽和で待ち行列が伸びる様子（レイテンシの急増・取りこぼし）が出る。VU 固定（think time あり）のクローズドモデルは、遅くなると要求が自然に減って限界を隠す。
2. **想定負荷は想定ピークの 40 倍**（20 req/s）。1 人用で本番ログが無いので、想定ピーク 0.5 req/s に安全率を掛けた。値の導出は `workload.yaml`。実測ではなく想定。
3. **毎反復で DB ボリュームを作り直す**。前の反復の件数・ファイルの断片化・キャッシュに左右されない。warm-up の後に計測する。
4. **操作比率**: load・capacity は 一覧 60 / 追加 25 / 完了切替 10 / 削除 5。stress・spike・soak は**追加と削除を同数**（15 / 15）にして件数を 1,000 前後に保つ。比率どおりだと追加が多く件数が増え、「負荷による劣化」と「件数による劣化」を分けられないため。
5. **トグル・削除の対象は、その VU が作ったタスク**。VU 間で競合せず、404 を誤って失敗に数えない。投入データ（DS-006）は一覧の件数としてだけ効く。
6. **乱数を使わない**。操作の選択は決定的な表（20 スロットを互いに素な歩幅で巡回）。再実行しても同じ列が出る。
7. **資源上限を想定本番に合わせる**（`compose.perf.yml`: backend 1 vCPU / 512 MiB、frontend 0.5 vCPU / 128 MiB）。測定機の違いで「余裕がある」ように見えるのを減らす。CPU の速さの差は揃わない。
8. **画面計測は Docker イメージ**（Playwright 公式イメージ + Lighthouse、digest 固定）。ホストにブラウザ・Lighthouse を入れない。compose のネットワーク内（`frontend:8080`）から測り、ポート転送の影響を避ける。
9. **k6 の threshold は早期警告**（abortOnFail なし）。合否の正本は `verdict.mjs`（外れ値除外・3 反復の平均・信頼区間を持つため）。k6 の終了コード 99（threshold 超過）は試験結果として扱い、run.sh は止まらない。

## 制約・できなかったこと（正直に）

- **本番が無く、実測ログも無い**。ワークロードは想定で、絶対値は本番の予測値ではない。外挿の限界・残存リスクは [`analysis.md`](analysis.md)。
- **DS-006 の `createdAt` は 1 秒間隔にできない**。API 経由の投入では backend が作成時刻で採番する（投入は数秒で終わる）。`seedTasks()`（一括 INSERT）は backend 内部の関数で、負荷試験は API だけを使う。
- 長時間 soak（2 時間以上）は今回**実施していない**（CI 短縮版 10 分のみ）。`SOAK_DURATION_SEC` で実行できる。
- 開発機（Apple Silicon の Docker Desktop）と GitHub-hosted runner（Linux ネイティブ）は性能特性が違う。baseline は**同じ環境の区分の run 同士**でだけ比べる（`env_class`）。runner の baseline は、初回の `perf.yml` 実行結果を `--update-baseline` で追記して作る（今回は実行できていない）。
- queue・外部依存の観測は、アーキテクチャに存在しないため取得していない。
