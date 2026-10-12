# 証跡（Evidence）

テストの実施結果・不具合・証拠を、**実際に動いたテストの結果から機械的に作り**、改変を検知できる形で保管する場所。
作り方と制約は `scripts/evidence/README.md`。ここは「何がどこにあり、どの形式か」を書く。

## 構成

```
docs/evidence/
  README.md              この文書
  manifest.json          管理対象ファイルごとの path / sha256 / size / captured_at / source（取得元 run の URL）/ version / head_sha
  artifacts.yaml         成果物台帳（文書ごとの版・状態・承認・履歴・sha256・保存方針）。build-artifacts.mjs が生成
  source-of-truth.yaml   正本の所在地（要求・UI・API・アーキテクチャ・セキュリティ要求・SLO・観点・ケース・不具合）。生成
  manual-plan.yaml       手動ケースの実施計画（未実施の理由・owner・実施予定日）。実施表の not_run 行の元
  runs/<run-id>/         CI の 1 回の実行の小さな成果物
    SOURCE.json          取得時刻・取得元 run の URL・対象 SHA・版・取り込んだ artifact の名前。`run_started_at` は ci-summary.json の開始時刻（`started_at`。集計ジョブの開始）で、GitHub の run の作成時刻ではない（例: run 38152472087 は run の作成 15:43:26Z、`run_started_at` 15:45:50Z）。後の run に置き換えられた run は `superseded_by`（置き換えた run・理由・日付）を持つ
    ci-summary.json      層ごとの結果・ジョブの結果・カバレッジ（scripts/ci/summarize-junit.mjs の出力）
    regression-selection.json   回帰の選択（モード・選択理由・除外したリスク）
    docs-check-report.json  coverage-backend.json  coverage-frontend.json
    junit/               JUnit XML（e2e-<project>-junit.xml / compose / backend / frontend / contract）
    observations/        テストが実際に観察した値（e2e / backend / frontend。TC-ID ごとの JSON）
  security/              SARIF・CycloneDX SBOM・scan-run.json・findings.json・gate.json の写し（security.yml の artifact から）
  perf/                  性能試験の結果（GitHub 上の run 38152548008。PR #61 で取り込み済み。`version` は取り込み時の既定 `pre-1.0.0` だったのを 1.0.0 に訂正し、`corrections` に記録した）
  monitoring/            外形監視の結果（取得したら置く。今は無い。Actions 上の実行は artifact `monitoring-results-<run_id>` に 90 日保存）
  github/                GitHub 統制の取得結果と、不具合 Issue のスナップショット（defect-issues.json）
```

各ディレクトリ（`runs/<run-id>/`・`security/`・`perf/`・`monitoring/`・`github/`）に `SOURCE.json` を置き、取得時刻・取得元 run の URL・対象 SHA・版を記録する。
`manifest.json` は上の 5 種のディレクトリの全ファイルを管理対象にする。**巨大な trace・video・HTML レポートは持ち込まない**（失敗時だけ CI の artifact を参照する。artifact は 90 日で消える）。

## 機械可読なエクスポート（どのファイルがどの形式か）

| 形式           | ファイル                                                                                                                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV            | `docs/data/` の `requirements` `risks` `perspectives` `cases` `datasets` `unknowns`（テスト設計）、`executions`（実施表）、`defects`（不具合表）、`findings`（セキュリティ検出）、`actions`（アクション）、`evidence-index`（証拠索引）、`traceability`（追跡表） |
| YAML           | `artifacts.yaml` `source-of-truth.yaml` `manual-plan.yaml`、`backend/openapi.yaml`（API 契約）、`quality/*.yaml`、`security/*.yaml`                                                                                                                              |
| JSON           | `manifest.json`、`runs/*/ci-summary.json` `regression-selection.json` `SOURCE.json`、`security/**/findings.json` `gate.json` `scan-run.json`、`github/defect-issues.json`、`runs/*/observations/**`                                                             |
| JUnit XML      | `runs/*/junit/*.xml`                                                                                                                                                                                                                                            |
| SARIF          | `security/**/*.sarif`（CodeQL・gitleaks・trivy・hadolint・ZAP・osv-scanner・compose-check）                                                                                                                                                                     |
| CycloneDX JSON | `security/**/*.cdx.json`（実行時依存 / 全体 / 各イメージの SBOM）                                                                                                                                                                                               |
| Markdown       | `docs/NN-*.md`（文書。表は CSV から機械生成した写しで、食い違うときは CSV が正）、`docs/adr/*.md`、この文書                                                                                                                                                     |

## 主張から証拠へ

`docs/data/evidence-index.csv` の 1 行 = 1 つの主張（claim）と、その証拠への参照（`ref`）。`ref` は `./docs/evidence/…#アンカー`（ファイル + アンカー）または run の URL。

- 実施表の行（例: 「TC-016 は chromium で pass」）→ `./docs/evidence/runs/<run>/junit/e2e-chromium-junit.xml#TC-016`（JUnit のそのケース）と、`…/observations/e2e/TC-016.chromium.json`（観察値）。
- 不具合 → `./docs/evidence/github/defect-issues.json#issue-<n>`（起票内容）。修正済みなら、関連ケースが pass した JUnit も。
- セキュリティ → `…/security/…/findings.json#F-002`（検出 1 件。`FND-002` に対応）、SARIF・SBOM・scan-run.json。
- `criterion_id` は qc-analyzer の観点（`execution-05` など）。`sha256` はファイルの実体のハッシュで、改変を `check-evidence.mjs` が検出する。**解決しない参照・ハッシュ不一致は失敗**。

ID の対応: `REQ` 要求 → `RISK` リスク → `VIEW` 観点 → `TC` ケース → `EXEC` 実施 → `DEF` 不具合（`DEF-<Issue 番号 3 桁>`）→ `FND` 検出 → `ACT` アクション、`EV` 証拠。
`FND-nnn` は security.yml の triage が付ける `F-nnn` を写したもの（`docs/data/findings.csv`）。**triage の番号は検出の並び順なので、検出が増減すると変わる**（安定した識別は `fingerprint`）。

## 版管理・保存・改変検知

- 正本は Git（`main` の Ruleset の定義 `.github/settings/ruleset-main.json` で force push・ブランチ削除・非 linear history を禁止する。適用の実態は governance の確認スクリプトで確かめる）。`artifacts.yaml` の `immutable_store` は Git 履歴で `true`、CI の artifact は `false`（90 日で消える）。リリース添付は永続。
- `retention_policy`: Git 履歴は永続。CI artifact は 90 日。リリース添付は永続。
- 改変検知: `manifest.json` が全ファイルの sha256 を持ち、`node scripts/evidence/verify-manifest.mjs` が再計算して不一致・欠落・未登録を検出する。`scripts/ci/docs-check.mjs` も同じ manifest を検証する。
- 版の混在: 実施表の `commit_sha` は 1 種類（リリースの SHA）だけを許す。別の版の行が残ると生成も検査も失敗する。

## 承認について（捏造しない）

`artifacts.yaml` の `approved_by` は、文書が「承認済み」と書いているものだけ（状態が「採用」の ADR の決定者。ADR は表でなく箇条書きの「状態」「決定者」から読む）。`draft` の文書（`docs/01〜13`）は承認前なので `null`。承認の根拠はどの文書も「PR のマージ（フェーズ1は AI が代行）」で、オーナーの確認が済むまで `reviewed`・`approved` にしない。
成果物の `status` は、文書のヘッダ表の「状態」。ヘッダ表が無いファイルは、PR を経てマージされ CI を通っているが承認の記録が無いので `reviewed`（承認者なし）にしている。

## データ分類・アクセス・秘密情報

- 分類: **public**（このリポジトリは public。ここの内容は誰でも読める）。利用者データ・実在の個人情報は含まない（テストデータは合成データのみ。`docs/data/datasets.csv`）。
- **人の氏名・メールアドレス・アカウント名・秘密情報らしい値は、証跡に残さない。** 取り込み時（`fetch-run.mjs`・`build-defects.mjs`）に**墨消し**する（`scripts/evidence/lib/redact.mjs`）。
  - 対象: 個人情報のキー（`author`・`committer`・`email` など。gitleaks の SARIF の `partialFingerprints`、CycloneDX の author）の値、メールアドレス形式、「氏名 <メール>」の氏名、`Co-Authored-By` などの氏名、アカウントのメンション（`@` に続くアカウント名）、リポジトリのオーナー名（URL・`owner/repo` の形以外で書かれたもの）、トークン・`password=` などの代入・秘密鍵の形式。`[REDACTED:author]`・`[REDACTED:email]`・`[REDACTED:account]`・`[REDACTED:secret]` に置き換える。
  - 決定的（同じ入力は同じ出力）。置き換えが無いファイルは、バイト単位でそのまま。URL に含まれるオーナー名（`github.com/<owner>/…`・`ghcr.io/<owner>/…`）と npm のスコープ（`@fastify/…`）は技術的な参照なので残す。
  - 記録: 墨消ししたファイルは `SOURCE.json` の `redactions` に、理由・規則ごとの件数・**元ファイルの sha256**・**墨消し後の sha256** を残す。`manifest.json` と証拠索引の sha256 は墨消し後のファイルで、manifest の項目に `original_sha256` と `redacted: true` が付く（元との対応が追える）。元の取得物は CI の artifact（90 日）に残る。Git 履歴には、墨消し方針より前に取り込んだ版の墨消し前のファイルが残りうる（下の「既知の制約」）。
- 検査: `scripts/evidence/check-evidence.mjs` が、`docs/data/` と `docs/evidence/` の全テキストに、トークン形式（AWS・GitHub・Slack・JWT・秘密鍵・`password=` などの代入）・メール・メンション・オーナー名・電話番号・カード番号の正規表現と、JSON の個人情報のキー（墨消し済みでない `author`・`email` など）を当てる。**許可リストの例外は作らない**（見つかったら、取り込み時の墨消しで取り除く）。セキュリティ側の gitleaks（履歴全体）と併用する。
- **正規表現は不在を証明しない。** 検出が 0 件でも、秘密情報・個人情報が無いとは言えない。最終確認は人が行う（観察値は短いので目視できる大きさにしてある）。
- **internal**（社内限り）に当たるものは、このリポジトリには置かない。置く必要が出たら、別の非公開の保管先と、この README の分類を決めてから。

### gitleaks の allowlist（`security/gitleaks.toml`）

- 対象・理由: `sourcegraph-access-token`（キーワード `sourcegraph`・`sgp_` を含むファイルの中の 40 桁の 16 進に当たるルール）を、`docs/evidence/` と `docs/data/` からだけ除く（`targetRules` 指定。ほかのルールは `docs/` 以下にも適用したまま）。証跡・生成表は commit の SHA（40 桁の 16 進）を必ず含み、gitleaks 自身の検出の記録（キーワード `sourcegraph`）も含むので、自己参照的に当たる（FND-012）。トークンではない。
- 確認: gitleaks 8.30.1（ピン留めの image）の dir モードを `docs/` に当てて 0 件（2026-10-12）。アクションは ACT-010。
- 見直す条件: gitleaks のルールが変わったとき、または証跡の形式が変わったとき（`security/gitleaks.toml` の description にも書いてある）。

## リリースの添付（release-evidence.zip）

GitHub Release v1.0.0 の添付 `release-evidence.zip` は、**2026-10-12 に墨消し済みの版で差し替えた**（元の版は削除した）。

| 項目 | 値 | 出典 |
|---|---|---|
| 現在の添付の sha256 | `75d2fa5c9b741efa24c40bf96a73b9331b7d9aae6da80f7c817cda02ec97021e` | `gh release view v1.0.0 --json assets`（`digest`。サイズ 436,272 バイト、更新 2026-10-11T17:16:30Z = 2026-10-12 02:16 JST） |
| 墨消し | 584 箇所・11 ファイル。検査（`scripts/ci/check-release-evidence.mjs`）で個人情報の検出 0 件（元の zip は 502 件） | PR #57、[scripts/evidence/README.md](../../scripts/evidence/README.md) |
| 差し替えの手順 | `scripts/ci/rebuild-release-evidence.mjs --run 38152472087` → `gh release upload v1.0.0 … --clobber` | [scripts/evidence/README.md](../../scripts/evidence/README.md) |
| 元の値が残る場所 | Git 履歴（墨消し方針より前に取り込んだ gitleaks の SARIF など。下の「既知の制約」）と、CI の artifact（90 日。2027-01-09 まで）。**Release の添付からは消えた** | [docs/13-evidence.md](../13-evidence.md) の evidence-09 |

## 既知の制約

- **Git 履歴には墨消し前のファイルが残る。** この方針の前に取り込んだ gitleaks の SARIF（run 38152472087 の取り込みコミット）には、検出に当たった commit の author 名と GitHub の noreply アドレスが入っており、force push は禁止なので、履歴からは消せない。公開リポジトリのコミットの author は元々公開情報で、この SARIF が新たに暴露したものではない。以降の証跡には入れない（現在のファイルは墨消し済みで、manifest・証拠索引は墨消し後の sha256）。
- 観察値は、テストが実際に見た値（画面の行・チェック状態・エラー文言・通信の method path → status・計測値・入力→結果の表）。**テストが見ていないことは書かれない**（例: 色・位置・フォーカス順の見た目は、そのテストが検査していなければ観察値に無い）。
- 手動ケース（TC-071・TC-072）は、実施していないので `not_run`。実施の記録（端末の版・観察・証拠）が付くまで `pass` にしない。
- 失敗した run の trace・video は、CI の artifact（90 日）にだけある。必要なら取り込み時に `fetch-run.mjs` を拡張して持ち込む（容量との相談）。
