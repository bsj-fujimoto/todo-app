# 外形監視（Monitoring as Code）・runbook

本リポジトリには**本番環境が無い**。そのため外形監視は、**リリース済みコンテナイメージ（GHCR、digest 固定）を GitHub Actions 上で compose 起動し、
localhost に対して実行する**構成にしている（リリースがまだ無い間は `docker compose up --build`（main の HEAD）にフォールバックし、run の summary に明記する）。
監視の定義・アラート経路・runbook・実行・通知試験のすべてをコードとして `monitoring/` と `scripts/monitoring/` に置き、PR レビュー（CODEOWNERS）を経て変更する。

## 構成

| 場所                                    | 内容                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `monitoring/monitors.yaml`              | 監視の定義（正本）。monitor_id・種別・対象・service・journey・SLI・slo_ref（`perf/slo.yaml`）・利用者影響・interval/timeout/retries・assertions・データの後始末・PII 方針・defined_in |
| `monitoring/alert-routes.yaml`          | severity（sev1〜3）・通知先（GitHub Issue ラベル `incident`）・on-call（ロール名 maintainer）・ack 方針・エスカレーション                                                             |
| `monitoring/maintenance.yaml`           | 計画停止の窓、リリース直後 15 分の抑制ルール（`suppression_rules`）、feature flag が無い旨                                                                                            |
| `monitoring/target.yaml`                | 監視対象の GHCR イメージ名（`release.yml` の push 先と一致させる）                                                                                                                    |
| `monitoring/runbooks/RB-00x-*.md`       | runbook（一次対応 / 切り分け / rollback / 連絡経路 / 訓練記録）と索引 `index.yaml`                                                                                                    |
| `monitoring/fp-fn-log.md`               | 誤検知・見逃しの台帳と運用ルール                                                                                                                                                      |
| `monitoring/alert-tests.md`             | 通知試験の記録                                                                                                                                                                        |
| `monitoring/drills/`                    | 通知試験・runbook 訓練の生の記録（時刻・結果・ack 時間）                                                                                                                              |
| `monitoring/history/`                   | 通常実行の run history（JSONL）・結果・デプロイマーカーの保存例（手元の実行）。GitHub Actions の実行履歴は artifact（90 日保持）                                                      |
| `scripts/monitoring/run-monitors.mjs`   | 監視の実行（依存は `yaml` のみ）。retry・timeout は定義どおり。メンテナンス窓・抑制ルールを評価して誤報を抑える（抑制も記録）                                                         |
| `scripts/monitoring/alert.mjs`          | 失敗 → incident Issue 作成（同じ monitor の open な Issue があればコメント追記）、回復 → コメントして close、未 ack のエスカレーション                                                |
| `scripts/monitoring/marker.mjs`         | デプロイマーカー（health の version / commit と GitHub Release のタグ・公開時刻）                                                                                                     |
| `scripts/monitoring/resolve-target.mjs` | 最新リリースのイメージ digest を引く / フォールバックの決定                                                                                                                           |
| `scripts/monitoring/check-config.mjs`   | 設定の整合性検査（slo_ref の解決、通知経路、ジャーニー網羅、runbook の 4 節）                                                                                                         |
| `e2e/synthetic/`                        | ブラウザジャーニー（Playwright）。`e2e/` の E2E テストとは独立（`package.json` も別）                                                                                                 |
| `.github/workflows/synthetic.yml`       | 30 分ごと（宣言。実効は 3.4〜6.7 時間）+ main への push + リリース成功後 + 手動（`drill: true` で通知試験）                                                                           |

## 重要ジャーニーと監視（ping ではない）

| ジャーニー                                    | http / api                                                                          | browser | 重大度             |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | ------- | ------------------ |
| J-01 追加 → 再読込で残る                      | MON-001（`GET /` が 200・`My TODO`・CSP ヘッダ）、MON-003（POST → GET → DELETE）    | MON-007 | sev1（配信）/ sev2 |
| J-02 完了切替                                 | MON-004（POST → PATCH → GET → PATCH → DELETE）                                      | MON-008 | sev2               |
| J-03 削除                                     | MON-005（POST → DELETE → GET → 再 DELETE が 404）                                   | MON-009 | sev2               |
| J-04 不正入力が弾かれ、保存データが変わらない | MON-006（空・101 文字・改行・不正本文 → 422 / 400 とエラー文言、件数不変）          | MON-010 | sev2               |
| J-05 保存失敗・破損でもデータを守る           | MON-013（`GET /api/v1/tasks` が 200・契約（TaskList）どおりで DATA_CORRUPT でない） | —       | sev1               |

ジャーニーの定義は `quality/journeys.yaml` に合わせている（J-01〜J-05）。**health（MON-002）はジャーニーではなくサービス監視**（`journey_id` は空。`service`・`sli`・`slo_ref` は持つ）で、`status=ok`・`db=ok`・version / commit が期待と一致（デプロイマーカー）を確かめる。
J-05 の「保存失敗に耐える」側（書込み不可・容量不足の注入）は、本番相当の環境で障害を注入できないため外形監視では見ない（API・E2E のテストが担当）。外形監視が見るのは「保存データが壊れていないか（DATA_CORRUPT になっていないか）」。

- 各 assertion は status だけでなく**内容**（本文・JSON の値・`backend/openapi.yaml` のスキーマ・ヘッダ・応答時間）まで確かめる。
- 契約の検証は `backend/openapi.yaml` の `components.schemas`（Task / TaskList / Health / Error）を読んで行う（`additionalProperties: false`・enum・UUID・日時形式）。
- 監視の `slo_ref` は `perf/slo.yaml` の `metric` を指す（性能試験と運用監視が同じ SLO を参照する）。

## 設計判断

1. **本番が無いので、リリース済みイメージを runner で起動して監視する。** 監視が確かめるのは「リリースしたイメージが起動して主要ジャーニーが通ること」であり、
   本番の可用性ではない。この差を summary（対象: リリース / フォールバック）と本書に明記する。
2. **資格情報を使わない。** アプリが認証なしの 1 人用なので `auth.method: none`・`inline_credentials: false`。合成データ（`synthetic-<run_id>-MON-xxx` のタイトル）だけを使い、個人情報を入れない。
3. **ジャーニーが作ったデータは必ず消す。** API ジャーニーは `cleanup`（DELETE、404 は許容）を成否にかかわらず実行し、後始末の失敗も失敗として報告する。
   ブラウザジャーニーは UI で削除し、`afterEach` で API からも消す。不正入力の監視（MON-006 / 010）は作成しない設計で、万一保存されたら件数差で検知する（本番データを誤って消さないため自動削除はしない）。
4. **retry は「最初の失敗の後の追加回数」。** `retries: 2` なら最大 3 回試す。timeout は 1 回の試行の上限。誤報を減らしつつ、最悪でも `timeout × (retries+1)` + 待機で結果が出る。
5. **誤報の抑制は隠さない。** メンテナンス窓・リリース直後 15 分に当たった失敗は通知しないが、run history には `result: fail`・`alert_suppressed: true`・`suppression_reason` 付きで残る。
6. **通知は GitHub Issue。** 個人用アプリのため外部の通知基盤を持たない。assignee は CODEOWNERS の既定の所有者（on-call ロール = maintainer）。
   重複を避けるため同じ monitor の open な Issue があればコメントを足す。回復したらコメントして close。drill は `drill` ラベルで分離する。
7. **`issues: write` は alert ジョブだけ。** 監視を動かすジョブは `contents: read`（と GHCR の `packages: read`）。全 Action はコミット SHA 固定。

## 実行方法（Docker / mise 経由。fish 構文を前提にしない）

リポジトリのルートで:

```sh
# 1) スタックを起動（main の HEAD をビルド）。COMMIT_SHA は health の commit に出る
COMMIT_SHA=$(git rev-parse HEAD) docker compose up -d --build --wait

# 2) 依存（yaml）とブラウザジャーニーの依存
mise x -- npm ci
mise x -- npm ci --prefix e2e/synthetic
mise x -- npx --prefix e2e/synthetic playwright install chromium

# 3) 設定の検査・単体テスト
mise x -- node scripts/monitoring/check-config.mjs
mise x -- node --test "scripts/monitoring/test/*.test.mjs"

# 4) マーカーと監視の実行（結果は monitoring/out/）
mise x -- node scripts/monitoring/marker.mjs --base-url http://localhost:8080 --out monitoring/out
mise x -- node scripts/monitoring/run-monitors.mjs --base-url http://localhost:8080 --out monitoring/out
#   一部だけ: --only MON-002,MON-003
#   アラート（gh の認証が必要。--dry-run なら表示のみ）:
mise x -- node scripts/monitoring/alert.mjs --results monitoring/out/results.json --out monitoring/out --dry-run
```

GitHub Actions では `synthetic.yml`（schedule〔宣言 30 分〕/ main への push / リリース成功後 / 手動）が同じ手順を実行する。手動実行で `drill: true` を選ぶと通知試験になる（下記）。

## 通知試験（drill）と runbook 訓練

- **通知試験**: `synthetic.yml` を `drill: true` で実行すると、backend コンテナを意図的に停止（`docker compose stop backend`）→ 監視（MON-002 = sev1、MON-003 = sev2）が失敗 →
  alert ジョブが `drill` ラベル付きの incident Issue を作成（assignee を確認）→ backend を復旧 → 監視が成功 → Issue にコメントして自動 close。
  時刻・結果・ack 時間は artifact `alert-test-<run_id>`（`alert-test.json` / `alert-test.md`）に出る。`monitoring/alert-tests.md` に転記する。
- **ack の扱い（正直な注記）**: 自動の試験では人の ack を観測できない。ack 方針の「assignee の確認」に当たる、**assignee（メンテナ）が設定されていることの確認**までを記録し、
  `ack_method` に方法を明記する。GitHub が assignee へ通知（メール・Web）を送るが、人が受け取ったことは観測できない。
- **runbook 訓練**: RB-002 の一次対応・rollback を実際に実行した記録を、各 runbook 末尾「訓練記録」と `monitoring/drills/` に残す。

## 検証できないもの・制約（理由付き）

| 項目                            | 状態                                                                   | 理由 / 本番を持つ場合に足すもの                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TLS 証明書の期限**（MON-011） | 定義するが `enabled: false`                                            | 本番ドメインと実証明書が無い。runner 内の localhost は HTTP のみで、**TLS 終端を compose に追加しない前提**。本番（独自ドメイン + TLS 終端）を持ったら有効化する。**重大度の基準（`alert-routes.yaml` の `threshold_escalation` と一致）**: 残り 14 日未満は sev3（予兆の警告）、7 日未満は sev2、失効後は MON-001（http）が sev1 で検知する |
| **DNS 解決**（MON-012）         | 定義するが `enabled: false`                                            | 本番ドメインが無い。runner 内は compose のサービス名と localhost で、実 DNS の解決・伝播は検証できない。本番を持ったら A/AAAA/CNAME の解決先と TTL を期待値と照合する。**重大度は sev1**（名前が引けない = 利用者が到達できない。RT-SEV1）                                                                                                   |
| **多地点（リージョン）監視**    | できない                                                               | 実行環境は GitHub-hosted runner（リージョン非固定）1 か所。`regions` には実行環境をそのまま書いた。本番を持つなら利用者の分布に合わせた複数リージョンから実行する                                                                                                                                                                            |
| **実行間隔 30 分**              | 宣言は 1800 秒、**実効は 3.4〜6.7 時間**（下の「実行間隔と検知時間」） | GitHub Actions の schedule は best-effort で、実測では宣言の 7〜13 倍に間隔が空き、枠の約 9 割が欠落した（`cadence.mjs`）。マージ・リリース直後の実行を足して補ったが、保証にはならない。本番を持つなら常駐の監視（外部 SaaS やクラスタ内プローブ）で 1〜5 分にする                                                                          |
| **本番の可用性**                | 測れない                                                               | 監視対象は「リリースしたイメージを runner で起動したもの」。`availability_synthetic_ratio`（`perf/slo.yaml`）は実行成功率で代用する                                                                                                                                                                                                          |
| **通知が人に届いたか**          | 観測できない                                                           | Issue の作成と assignee の設定までを到達として扱う。メール・Slack 等の外部通知は無い                                                                                                                                                                                                                                                         |
| **単一メンテナ**                | 残存リスク                                                             | on-call はロール名 maintainer（CODEOWNERS の既定の所有者 1 名）。ack が 24 時間無くても、リマインド（コメントとラベル `ack-overdue`）以外の経路が無い                                                                                                                                                                                        |
| **GitHub の schedule の無効化** | 残存リスク                                                             | リポジトリに 60 日間活動が無いと schedule は無効になる（RB-005）。実行が止まっていても気づけない                                                                                                                                                                                                                                             |

## 変更の手順（Monitoring as Code）

1. `monitoring/monitors.yaml` などを PR で変更（CODEOWNERS のレビュー必須。`.github/` と同様に `monitoring/` も所有者のレビュー対象にする）。
2. `node scripts/monitoring/check-config.mjs` と単体テストが通ること（`synthetic.yml` の最初のステップでも実行される）。
3. **製品の振る舞い（画面・API・文言・操作の順序）を変える PR は、外形監視の期待（`monitors.yaml` の assertions / steps、`e2e/synthetic/journey.spec.js`）が変わらないかを同じ PR で確かめる**（PR テンプレートの確認項目）。変わるなら同じ PR で監視を直す。直し忘れると、製品は正しいのに監視が失敗する誤検知になる（初回の Actions 実行で #12 の変更により MON-008 が誤検知した。`fp-fn-log.md`、#36）。ブラウザジャーニーの操作の取り方は `e2e/fixtures/todo-app.js`（E2E）と揃える。
4. 誤検知・見逃しに起因する変更は `monitoring/fp-fn-log.md` に PR 番号とともに記録する。
5. 戻す必要があるときは `git revert`（履歴を書き換えない）。RB-005 の rollback を参照。

## インシデント → 改善への還流

- incident Issue（`.github/ISSUE_TEMPLATE/incident.md`、自動起票も同じ書式）の「再発防止（還流先）」に、defect・テスト・監視・runbook の 4 つの還流先を持つ。
- close するときは各項目を「実施（記録: Issue / PR / TC 番号）」か「不要（理由）」にする。監視の調整は `fp-fn-log.md`、runbook の更新は各 runbook の「訓練記録」と対応させる。
- 直前のデプロイ（version / commit / release タグ）は Issue 本文に自動で入る（`deployment_ref`）。リリースと異常開始時刻の相関はこのマーカーで追える。

## 監視基盤自身の沈黙への対策

監視が壊れて何も鳴らないことが最も危ない（incident も立たない）。次の 4 層で防ぐ。

1. **PR の CI（`ci.yml` の lint ジョブ）**: `scripts/monitoring/check-config.mjs`（monitors・通知経路・runbook・SLO 参照・応答時間の定義と実装の整合）と、`scripts/monitoring` / `scripts/perf` の単体テストを実行する。設定を壊した PR は main に入らない。
2. **実行基盤の失敗（`synthetic.yml` の `meta-alert`）**: compose の起動・依存の導入・Playwright の導入などで**監視の結果が出る前に** synthetic ジョブが失敗したとき、incident Issue `[sev3][MON-META] 外形監視の実行に失敗` を起票する。監視の失敗（アプリの障害）は結果が出るので `alert` ジョブが `[sevN][MON-xxx]` で起票し、両者は区別される（ジョブの出力 `results_present`）。次の実行が最後まで動けば、`alert` ジョブが回復を書いて close する。
3. **監視の死活監視（`monitoring-watchdog.yml`、宣言 3 時間ごと）**: `synthetic.yml` の最終実行がしきい値より前なら `[sev3][MON-META] 外形監視が <しきい値> 時間以上実行されていない` を起票する。**しきい値は 8 時間**（`monitors.yaml` の `watchdog.threshold_hours` が正本。ワークフローには書かない。決め方は下の「実行間隔と検知時間」）。当初の 3 時間は宣言（30 分）に合わせた値で、実効間隔に対して誤報になる見込みだった（#59。`fp-fn-log.md`）。実際に動いた run（skipped・cancelled を除く）だけを数える。`workflow_dispatch` の `drill_threshold_hours` で、しきい値を下げて起票〜close の経路を通せる。
4. **runbook RB-005**: MON-META の一次対応・切り分け・rollback。
5. **起動の契機を足す（`synthetic.yml` の `push: main` と、Release 成功後の `workflow_run`）**: schedule が遅延・欠落しても、マージ直後・リリース直後に必ず 1 回動く（実行は約 3.5 分で結果が出る）。schedule を置き換えるものではなく、MTTD の補完。

**制約**: 死活監視（3）も GitHub の schedule で動く。schedule 自体が止まる（リポジトリに 60 日活動が無いと無効化される、GitHub 側の障害）と一緒に止まり、同じ基盤の死活は同じ基盤では監視できない。この場合はメンテナが定期的に Actions を確認するしかない（残存リスク。外部の常駐監視を持てば解消する）。

## incident と defect を兼ねる Issue の書式（追記する。書き換えない）

外形監視の incident Issue（`[sevN][MON-xxx]`）が、調べた結果「欠陥（defect）」として扱う内容（誤検知の監視定義・製品の不具合など）だった場合は、**起票時の本文を残したまま、defect テンプレート（`.github/ISSUE_TEMPLATE/defect.md`）の項目を末尾に追記する**。本文を書き換えると、起票時の「再発防止（還流先）」チェックリスト・`deployment_ref`（直前のデプロイ）・ack 欄・失敗の詳細が消え、編集履歴にしか残らなくなる（#36 で起きた。追記して復元した）。

- 手順: ①ラベル `defect` を足す（`incident` は外さない）、②本文の末尾に `---` と `## 不具合としての記録（defect）` を置き、識別・再現手順・期待結果・実際の結果・影響・原因分類を書く、③再発防止（還流先）のチェックリストは起票時のものを使い、実施した項目にチェックを付けて記録を書く。
- `incident.md` テンプレートの先頭の注記にも同じ規則を書いた。

## 実行間隔と検知時間（MTTD）・可用性 SLO との整合

**宣言（設計目標）と実測（観測値）を分けて持つ。** 実測は `node scripts/monitoring/cadence.mjs`（gh api の読み取りのみ。`--out monitoring/cadence` で記録を残す。`monitoring-watchdog.yml` も実行のたびに summary へ出す）。記録: [`monitoring/cadence/cadence-20261012T0803Z.md`](cadence/cadence-20261012T0803Z.md)（JSON も同じ名前）。

| 項目                                | 宣言（設計目標）                 | 実測（2026-10-12 08:03Z の時点）                                                                                                                                             |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| synthetic.yml の schedule           | cron `7,37 * * * *` = **30 分**  | 実行 4 回（枠 39 に対し欠落 35）。間隔 **3.8・3.4・6.7 時間**（中央値 3.8 時間、最大 6.7 時間）。有効化〜初回 5.4 時間                                                       |
| nightly.yml の schedule             | 毎日 18:00 / 日曜 20:00（UTC）   | 実行 2 回（欠落なし）。枠からの遅れ **3.4・3.3 時間**（枠が疎なので cron の遅延として読める）。有効化〜初回 12.8 時間                                                        |
| monitoring-watchdog.yml の schedule | cron `47 */3 * * *` = **3 時間** | 実行 2 回（枠 5 に対し欠落 3）。間隔 **8.1 時間**（標本 1 件）。有効化〜初回 6.0 時間                                                                                        |
| 1 回の実行の所要                    | -                                | 約 3.4 分（run 38220637289。起動待ち 2 秒、synthetic ジョブ 3 分、alert ジョブ 27 秒）                                                                                       |
| MTTD（検知までの時間）              | 30 分 + retry                    | **実効間隔 + retry**: 中央値 3.8 時間、最悪 6.7 時間（実測の最大。障害が起きてから次の実行まで。平均は約半分）+ retry 約 2 分。マージ・リリース直後は約 3.5 分（契機の追加） |
| 沈黙の検知（watchdog）              | 3 時間                           | しきい値 **8 時間**。watchdog 自身の実効間隔も 8.1 時間なので、沈黙から起票までは最悪 約 16 時間（8 + 8.1。推定、標本が少ない）                                              |

標本は少ない（実行 4 回・間隔 3 件、有効化から約 20 時間）。GitHub は新しい・活動の少ないリポジトリの schedule を後回しにする（公式に保証されない）ため、時間が経てば実効間隔が縮む可能性もあれば、混雑でさらに伸びる可能性もある。**再測定して `observed_*` としきい値を見直す**（下の手順）。

### 決めたこと

- **`interval_sec` は宣言の 1800 秒を維持する（設計目標）。実測は別項目 `observed_interval_sec`（中央値 13,826 秒）・`observed_interval_max_sec`（最大 24,031 秒）・`observed_at`・`observed_source` として持つ**（`monitors.yaml` の `defaults`）。理由: ①目標を観測に合わせて緩めると、基盤の劣化が「目標どおり」に見えて、MTTD の議論も本番の常駐監視へ移すときの目標も失われる。②実測は run のたびに変わる値で、設計の固定値には向かない（記録とスクリプトで再現できる観測として扱う）。③宣言と実測の乖離そのものが残存リスク（本書の制約表）で、数字で見えるようにしておく。`check-config.mjs` が、`interval_sec` と `synthetic.yml` の cron の間隔の一致、`observed_*` と記録ファイルの存在、しきい値が最大実測間隔 + 余裕以上であること、を検査する（食い違うと CI が落ちる）。
- **MTTD は「実測の実効間隔 + retry 時間」で見る。** retry は `timeout_sec × (retries + 1)` と待機（5 秒）まで（MON-007 は 60 秒 × 2 + 5 秒 ≈ 2 分、MON-002 は 10 秒 × 3 + 10 秒 ≈ 40 秒）。cron の遅延は目標に含められない（保証しない）。
- **watchdog のしきい値は 8 時間。** 規則: 最大の実測間隔（synthetic.yml の schedule）を時間に切り上げ、余裕 1 時間を足す（6.7 → 7 → **8 時間**。`cadence.mjs` が `recommendation` として出す）。標本が 3 件未満なら決めない。理由: 当初の 3 時間（宣言の 6 倍）は実効間隔（3.4〜6.7 時間）より短く、実行が正常に動いていても誤報になる（#59 がその例。起票から約 84 分後の次の schedule 実行で自動 close）。しきい値を長くした代わりに、沈黙の検知は遅くなる（上表）。短い沈黙は、マージ・リリース直後の実行と、手で見る運用で補う。
- **見直しの手順**: ①`node scripts/monitoring/cadence.mjs --out monitoring/cadence` で再測定、②`recommendation.hours` が現在のしきい値と違えば `monitors.yaml` の `watchdog.threshold_hours`・`observed_*`・`observed_source` を同じ PR で更新、③誤報・見逃しがあれば `fp-fn-log.md` に記録。

### 起動の契機の追加（マージ直後・リリース直後に必ず 1 回）

| 契機                                                          | 採否   | 理由                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `push: branches: [main]`                                      | 採用   | マージ直後に 1 回動く。CI の成否に依らず、監視定義（`monitors.yaml`・ジャーニー）が製品の最新と合っているかを見る（#36 型の誤検知を、次の schedule を待たずに知る）。docs だけのマージでも動く（死活の確認にもなる）。PR では動かない |
| `workflow_run`（Release の完了、成功かつ push〔タグ〕のとき） | 採用   | リリース直後に、新しいイメージ・Release（デプロイマーカー）を監視対象にして 1 回動く。dry-run・PR・失敗した Release は条件で除く（skipped になる。watchdog は skipped を「動いた」に数えない）                                        |
| CI の完了後の `workflow_run`                                  | 見送り | PR の CI の完了でも発火して skipped の run が増える（branches で絞れるが、push を直接契機にする方が単純）。監視は CI の結果に依存させない                                                                                             |
| cron を増やす（`*/15` など）                                  | 見送り | 欠落は GitHub 側の優先度によるもので、枠を増やして実効間隔が縮むかは未検証。効果を測れる状態になってから（`cadence.mjs` で測り直す）                                                                                                  |
| 外部の常駐監視（SaaS・クラスタ内プローブ）                    | 見送り | 本番も外部サービスの契約も無い。残存リスクとして書く（制約表）。本番を持ったら 1〜5 分間隔にする                                                                                                                                      |

- **過剰実行・無限ループの防止**: `concurrency: synthetic`（`cancel-in-progress: false`）で同時実行は 1 本、待ちは最新の 1 本に置き換わる（連続マージでも待ちは 1 本。置き換えられた待ちは cancelled で、watchdog は数えない）。`synthetic.yml` は push もリリースも作らない（Issue と artifact だけ）ので、自分自身を起動しない。
- **実測の限界**: `push` と `workflow_run` は main にマージされるまで動かない（`workflow_run` は既定ブランチのワークフローだけが動く）。マージ前は `workflow_dispatch` で定義の動作（`if` 条件・summary）まで確認でき、実際の契機での起動は**マージ後の最初の push で確認する**。Release の `workflow_run` は次のリリース（タグ push）まで未確認。

### 可用性 SLO との整合

`perf/slo.yaml` の `availability_synthetic_ratio` ≥ 99% は「障害の継続時間」ではなく「**実行の成功率**」で定義している。実効間隔が中央値 3.8 時間だと、30 日の実行は約 190 回（宣言どおりなら約 1,440 回）+ マージ・リリース直後の実行で、99% は失敗 1〜2 回までに相当する（標本が少ないので 1 回の失敗で下回りうる）。実効間隔より短い障害は**観測できない**（実行の間に起きて回復すれば見逃す）ため、SLO は障害時間の上界ではなく標本からの推定である。短い障害（再起動・数分の停止）の検知は、アプリ側の再起動復帰（TC-042/043/077）の試験が担当し、外形監視は「ある時点でジャーニーが通るか」を保証する。見逃し（false negative）が実際に出たら `fp-fn-log.md` に記録し、間隔を詰める判断材料にする（その場合の次の手は常駐の監視）。
