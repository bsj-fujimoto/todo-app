# scripts/evidence — 実施結果・不具合・証跡台帳の生成と検査

**CI の実行結果から、機械的に**、実施表・不具合表・証拠索引・追跡表・成果物台帳を作り、改変を検知する道具。依存ゼロ（Node 組み込みだけ。`scripts/ci/lib` の CSV・JUnit・YAML の読み書きを再利用）。
作る側の原則は「実際に動いたテストの結果から生成する。観察できなかったことは『できなかった』と書く」。偽装・水増しをしない。

## 全体の流れ

```
テスト（e2e / backend / frontend）──観察値──> test-results/observations/<TC-ID>.json
        │                                         │
        └── CI の artifact（JUnit・観察値・ci-summary.json・regression-selection.json）
                      │  fetch-run.mjs（gh run download）
                      ▼
        docs/evidence/runs/<run-id>/   ← 小さな成果物だけ。SOURCE.json に取得時刻・run の URL・対象 SHA
                      │  build-executions.mjs
                      ▼
 docs/data/executions.csv（実施表）  docs/data/evidence-index.csv（証拠索引）
 docs/data/defects.csv  ← build-defects.mjs ← GitHub Issues（label: defect / flaky）
 docs/data/findings.csv ← build-findings.mjs ← docs/evidence/security/**/findings.json
 docs/data/traceability.csv ← build-traceability.mjs   docs/evidence/manifest.json ← build-manifest.mjs
 docs/evidence/artifacts.yaml・source-of-truth.yaml ← build-artifacts.mjs（文書のヘッダ表と git log から）
                      │
                      ▼  check-evidence.mjs（manifest・ID 参照・パリティ・実施表・不具合・証拠索引・アクション・追跡表・秘密情報）
```

## 1. 観察値の採取（テスト側）

各テストが**実際に観察した値**を、終了時に自動で書き出す（アサーションは弱めていない。テスト名の `[TC-xxx]` も維持）。

| 層            | 書き出し先                                                                  | 内容                                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| e2e / compose | `e2e/test-results/observations/<TC-ID>.<project>.json`                      | 一覧の行（表示テキスト・チェック状態・通信中）・入力欄の値・表示中のエラー文言・フォーカス、観測した API 呼び出し（method path → status）、ブラウザ名と版・ビューポート・OS・Node 版。`annotations`（type `observed`）にも要約 |
| backend api   | `backend/test-results/observations/<TC-ID>.json`                            | 全リクエストの method path → status と要求・応答の要約。性能・並行・再起動は `observe(label, value)` で実測値（p95・件数・所要）                                                                                               |
| unit          | `backend/test-results/observations/`・`frontend/test-results/observations/` | 検証関数の入力 → 実際の結果の実測表、画面・状態の要約                                                                                                                                                                          |

- 実装: `backend/test-support/observe.js`（入れ物・上限・書き出し）、`observe-node-test.js`（node:test 用の自動採取）、`e2e/fixtures/observe.js`（auto fixture と `observe`）。
- サイズは小さく（行数 10・タイトル 40 文字・呼び出し 30 件・note 20 件。上限は `LIMITS`）。**UUID は `{uuid}` に伏せる**（意味が無く、0 が並ぶ UUID は電話番号の正規表現に誤検出されるため）。利用者データは合成データのみ。
- 同じ TC の複数テストは、1 つのファイルの `entries` に並ぶ（同じタイトルは置き換え＝再実行しても増えない。並列でも壊れないよう mkdir でロックする）。
- 実施時刻（`started_at`）と環境、`run`（commit SHA・run id。CI は `TARGET_SHA`・`GITHUB_RUN_ID`、ローカルは `local`）を各 entry に持つ。
- CI の artifact に載る（`e2e/test-results`・`backend/test-results`・`frontend/test-results` は既にアップロード対象）。**workflow の変更は不要**。

## 2. 手順（コマンド）

```sh
npm ci
# ① run の成果物を取り込む（gh 認証済み。--run を渡せば build-executions が自動で取得する）
node scripts/evidence/fetch-run.mjs --run <ci-run-id>                       # docs/evidence/runs/<id>/ を作り直す
node scripts/evidence/fetch-run.mjs --kind security --run <security-run-id> # SARIF・SBOM・scan-run・findings・gate の写し（docs/evidence/security/）
# ② 不具合 → 実施 → 不具合（修正確認の証拠を足すため 2 回目は --offline）
node scripts/evidence/build-defects.mjs
node scripts/evidence/build-executions.mjs --run <ci-run-id> --retest-due 2026-10-31
node scripts/evidence/build-defects.mjs --offline
# ③ 派生する表・台帳
npm run evidence:build   # defects --offline → findings → evidence-index → traceability → manifest → artifacts
# ④ 検査
npm run evidence:check   # manifest・ID 参照・パリティ・実施表・不具合・証拠索引・アクション・追跡表・秘密情報
```

`--artifacts <gh run download の出力ディレクトリ>` で、取得済みの artifact から取り込める。リリース用の最終生成は、`v*.*.*` タグの run で `--run <id> --prune-other-versions --release <SHA>` を付けて行う
（実施表に別の版の行を残さない。残っていると失敗する）。

### リリースの run の取り込み（管理者が行う）

`release.yml` は、リリース前層（`ci.yml` + `security.yml`）・証跡の検査（`evidence-check`）・公開を 1 つの run で行い、artifact（`ci-summary`・`ci-summary-*`・`security-findings`・`security-scan-*`・`release-evidence` など）を 90 日保存する。
その run の結果を証跡（`docs/evidence/`・`docs/data/`）に取り込むのは、ワークフローではなく**人が行う**（ワークフローから main へ直接 commit しない）:

```sh
# リリース run の id は release.yml の run の URL（.../actions/runs/<id>）か、リリースノートの「ビルドした run」から分かる
node scripts/evidence/fetch-run.mjs --run <release-run-id>                       # CI の成果物（JUnit・観察値・ci-summary・regression-selection）
node scripts/evidence/fetch-run.mjs --kind security --run <release-run-id>       # security の SARIF・SBOM・scan-run・findings・gate
node scripts/evidence/build-executions.mjs --run <release-run-id> --prune-other-versions --release <リリースの SHA>
npm run evidence:build && npm run evidence:check
node scripts/evidence/check-evidence.mjs --release <リリースの SHA> --strict      # release.yml の evidence-check と同じ検査
```

- `release.yml` の `evidence-check` ジョブ（`--release "$TARGET_SHA" --strict`）は、**タグが指す commit に commit 済みの証跡**を検査する。したがって、実施表の `commit_sha` が、タグを打つ commit と一致していること（別の版の行が残っていないこと）が公開の条件になる。
  証跡の取り込みを commit したあとの commit にタグを打つ場合、実施表の対象 SHA はその commit と一致しない点に注意（取り込む run の SHA を、タグを打つ commit の SHA にそろえる運用を決めておく）。
- 新しい検出（`FND-NEW-xxxxxx`）が出たら、`node scripts/security/assign-finding-ids.mjs --findings <findings.json> --write` で `security/finding-ids.yaml` に番号を振って commit する。
- CI（`ci.yml` の docs-check）は、PR のたびに `check-evidence.mjs`（`--strict` なし）と `npm run evidence:test` を回す。

### 再生成の冪等性

- `executions.csv`: 同じ run の行は置き換える。EXEC-0001 形式の ID は（run, TC, 環境）が同じなら引き継ぐ。別の版の行が残るときは失敗（`--prune-other-versions` で捨てる）。
- `evidence-index.csv`: EV-0001 は（参照, 主張）の組で固定。実施表・不具合表から参照されなくなった実施由来の EV は落とす。
- `defects.csv`: 取得した Issue が前回と同じなら、スナップショットも取得時刻も書き換えない。`--offline` はコミット済みのスナップショットだけで同じ表を作る。
- `manifest.json`・`artifacts.yaml`: 内容が同じなら変わらない（`--check` で確かめられる）。

## 3. 各スクリプト

| スクリプト                 | 役割                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch-run.mjs`            | artifact を 1 つずつ取り（`*.dockerbuild` は除く）、小さな成果物だけを `docs/evidence/` へ。`SOURCE.json` を作る。`--kind ci / security / perf / monitoring / github`                                                                                                |
| `build-executions.mjs`     | JUnit・観察値・`ci-summary.json`・`regression-selection.json` から実施表。1 行 = 1 ケース × 1 実行環境 × 1 run。全ケースに 1 行以上（無ければ `not_run` + 理由）。手動ケースは実施していなければ `not_run`（理由・owner・予定日は `docs/evidence/manual-plan.yaml`） |
| `build-defects.mjs`        | Issue（`defect`・`flaky`）→ `defects.csv`。本文は `.github/ISSUE_TEMPLATE/defect.md` の見出しと「- キー: 値」を読む。語彙を統一し、欠けた項目は Issue 番号つきで指摘して失敗する（事実に基づいて Issue 本文を補筆してから再実行）                                    |
| `build-findings.mjs`       | security の `findings.json` → `findings.csv`。finding_id は triage が振った安定 ID `FND-nnn`（FND を docs/data の中で定義する。未登録の仮 ID があれば失敗）                                                                                                          |
| `build-evidence-index.mjs` | 証拠索引。run 全体・セキュリティ（検出 1 件ごと）・性能・監視・GitHub 統制の証拠を足し、全参照（ファイル・アンカー・sha256）を検査                                                                                                                                   |
| `build-traceability.mjs`   | REQ → RISK → VIEW → TC → EXEC → DEF → FND → ACT。ケースに結び付かない要求・リスク・観点・検出・アクションは `gaps` つきの行で残す                                                                                                                                    |
| `build-manifest.mjs`       | `docs/evidence/manifest.json`（path / sha256 / size / captured_at / source / version / head_sha）                                                                                                                                                                    |
| `verify-manifest.mjs`      | 全ファイルを再計算して、不一致・欠落・未登録を検出（改変検知）                                                                                                                                                                                                       |
| `build-artifacts.mjs`      | `artifacts.yaml`（文書ごとの版・状態・承認・履歴・sha256・保存方針）と `source-of-truth.yaml`。文書のヘッダ表と `git log` から作る                                                                                                                                   |
| `check-parity.mjs`         | md の「N 件（TC）」と表の行数、「`cases.csv` の列: …」と実際の列を突き合わせる                                                                                                                                                                                       |
| `check-evidence.mjs`       | 上をまとめて検査（CI の docs-check 向け）。`--out report.json`・`--release <SHA>`・`--strict`                                                                                                                                                                        |

## 4. 設計判断と制約

- **観察値と JUnit が正本**。`actual_result` は観察値だけから組む（期待結果は読まない）。観察値が無い行は「観察値なし」と書き、JUnit が記録した事実（件数・結果・所要）だけを添える。期待結果と同一なら失敗、全文を含む・短すぎるものは警告。
- `kind`: `pull_request` の run は `automated`、それ以外（push・schedule・dispatch・release）の全件回帰は `regression`、手動ケースは `manual`。`status` は `pass / fail / blocked / not_run / skipped`（小文字）。
- 版の混在: 実施表の `commit_sha` は 1 種類。観察値・ci-summary・SOURCE.json の SHA と run id も突き合わせる。JUnit の層ごとの件数が `ci-summary.json` と違うときも失敗（取り込み漏れ・別 run の混入）。
- `finding_id` は security の triage が、fingerprint から決まる**安定 ID**（`FND-nnn`。台帳 `security/finding-ids.yaml`）で振る。検出が増減しても同じ検出は同じ番号を保つ。
  台帳に無い新しい検出は仮 ID（`FND-NEW-xxxxxx`）で出て、`build-findings.mjs` が失敗する。`node scripts/security/assign-finding-ids.mjs --findings <findings.json> --write` で番号を振って commit してから取り込み直す
  （旧形式の `F-001` の findings.json も `FND-001` に写せる）。
- `artifacts.yaml` の履歴・更新日時は**コミット済み**の内容から作る。文書を更新したら、コミット後に `build-artifacts.mjs` を再実行する（古ければ `check-evidence.mjs` が警告、`--strict` で失敗）。
- `build-defects.mjs` の `release` は、起票日以前で最新の `v*` タグ（無ければ `pre-1.0.0`）。`source` は検出工程が production なら production、それ以外は test。
- 正規表現による秘密情報・個人情報の検査は**不在を証明しない**（`docs/evidence/README.md`）。
- 取り込むのは小さな実行成果物だけ。失敗時の trace・video・HTML レポートは持ち込まない。

## 5. テスト

```sh
npm run evidence:test   # node:test（固定の入力・時刻なし）。CI では scripts の他のテストと一緒に回す
```
