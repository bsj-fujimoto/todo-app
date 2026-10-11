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
    SOURCE.json          取得時刻・取得元 run の URL・対象 SHA・版・取り込んだ artifact の名前
    ci-summary.json      層ごとの結果・ジョブの結果・カバレッジ（scripts/ci/summarize-junit.mjs の出力）
    regression-selection.json   回帰の選択（モード・選択理由・除外したリスク）
    docs-check-report.json  coverage-backend.json  coverage-frontend.json
    junit/               JUnit XML（e2e-<project>-junit.xml / compose / backend / frontend / contract）
    observations/        テストが実際に観察した値（e2e / backend / frontend。TC-ID ごとの JSON）
  security/              SARIF・CycloneDX SBOM・scan-run.json・findings.json・gate.json の写し（security.yml の artifact から）
  perf/  monitoring/     性能・外形監視の結果（取得したら置く。今は空）
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

`artifacts.yaml` の `approved_by` は、文書が「承認済み」と書いているものだけ（ADR-0001 の決定者）。`draft` の文書は承認前なので `null`。
成果物の `status` は、文書のヘッダ表の「状態」。ヘッダ表が無いファイルは、PR を経てマージされ CI を通っているが承認の記録が無いので `reviewed`（承認者なし）にしている。

## データ分類・アクセス・秘密情報

- 分類: **public**（このリポジトリは public。ここの内容は誰でも読める）。利用者データ・実在の個人情報は含まない（テストデータは合成データのみ。`docs/data/datasets.csv`）。
- 例外として、SBOM（`*.cdx.json`）には第三者パッケージ（alpine・nginx・npm）が公開しているメンテナのメールアドレスが含まれる。公開メタデータで、原本の sha256 を保つため伏字にしない。
- **internal**（社内限り）に当たるものは、このリポジトリには置かない。置く必要が出たら、別の非公開の保管先と、この README の分類を決めてから。
- 検査: `scripts/evidence/check-evidence.mjs` が、`docs/data/` と `docs/evidence/` の全テキストに、トークン形式（AWS・GitHub・Slack・JWT・秘密鍵・`password=` などの代入）とメール・電話番号・カード番号の正規表現を当てる。セキュリティ側の gitleaks（履歴全体）と併用する。
- **正規表現は不在を証明しない。** 検出が 0 件でも、秘密情報・個人情報が無いとは言えない。最終確認は人が行う（観察値は短いので目視できる大きさにしてある）。
  誤検出（CodeQL のルール説明のサンプル、SBOM のメンテナ宛先）は `scripts/evidence/lib/sensitive.mjs` の許可リストに、理由つきで書く。

## 既知の制約

- 観察値は、テストが実際に見た値（画面の行・チェック状態・エラー文言・通信の method path → status・計測値・入力→結果の表）。**テストが見ていないことは書かれない**（例: 色・位置・フォーカス順の見た目は、そのテストが検査していなければ観察値に無い）。
- 手動ケース（TC-071・TC-072）は、実施していないので `not_run`。実施の記録（端末の版・観察・証拠）が付くまで `pass` にしない。
- 失敗した run の trace・video は、CI の artifact（90 日）にだけある。必要なら取り込み時に `fetch-run.mjs` を拡張して持ち込む（容量との相談）。
