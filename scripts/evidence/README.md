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
 executions.csv の kind=performance の行 ← build-perf-executions.mjs ← docs/evidence/perf/（perf 層の verdict.json）と perf/slo.yaml
 docs/data/deviations.csv ← build-deviations.mjs ← docs/09 の DEV 表（正本）
 docs/data/api-results.csv ← build-api-results.mjs ← backend/test/api-tags.yaml + 取り込んだ run の JUnit・観察値 + テストの実装
 docs/evidence/run-roles.yaml ← build-run-roles.mjs ← 各 SOURCE.json・perf/results/*/run.json（対象版か履歴か）
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
npm run evidence:build   # defects --offline → findings → perf 行 → deviations → api-results → run-roles → evidence-index → traceability → manifest → artifacts
# ④ 検査
npm run evidence:check   # manifest・ID 参照・パリティ・実施表・不具合・証拠索引・アクション・追跡表・run の役割・API 結果表・秘密情報
```

`--artifacts <gh run download の出力ディレクトリ>` で、取得済みの artifact から取り込める。リリース用の最終生成は、`v*.*.*` タグの run で `--run <id> --prune-other-versions --release <SHA>` を付けて行う
（実施表に別の版の行を残さない。残っていると失敗する）。

### リリースの証跡の運用（タグ X → run → 取り込みコミット Y）

**タグは必ず「テストした製品 commit X」に打つ。** 実施表・証跡は X の run から作り、あとで commit Y として main に入れる。したがって X の時点の `release.yml` は、X の実施表をまだ持てない。検査はこの前提で分けてある。

| いつ・どこで                                                                      | 何を検査するか                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| タグ X の `release.yml`（`evidence-check` ジョブ。`publish` の条件）              | **構造だけ**（`check-evidence.mjs --structure-only`: ID 解決・manifest の sha256・パリティ・不具合表・証拠索引・秘密混入など）。版は固定しない                                                                                                                        |
| Y 以降の `ci.yml`（docs-check の `check-evidence.mjs`）                           | `docs/evidence/release.json` があれば、その `commit_sha`（= X）を `--release` に **`--strict`** で検査（実施表の全行の `commit_sha` が X で、版の混在が無い。ID 解決・manifest・パリティも失敗）。**成果物台帳が古いことは警告**。無ければスキップと明示し、非 strict |
| 最終整合（管理者が手元で 1 回。`release.yml` の `evidence-check` にも付ける想定） | 上に加えて **`--strict-artifacts`**: 成果物台帳（`artifacts.yaml`・`source-of-truth.yaml`）が古いことも失敗にする（`build-artifacts.mjs` の再生成漏れ）。`git log` を読むので `fetch-depth: 0` が要る                                                                 |

`docs/evidence/release.json`（取り込み時に管理者が書く。ワークフローは書かない）:

```json
{
  "release": "v1.0.0",
  "tag": "v1.0.0",
  "commit_sha": "<X: テストした製品 commit の 40 桁の SHA>",
  "images": { "backend": "sha256:…", "frontend": "sha256:…" },
  "run_id": 123456789,
  "recorded_at": "2026-10-11T10:00:00Z"
}
```

形式（版・タグ・SHA・digest・run・日時）は `check-evidence.mjs` の `release-record` 検査が確かめる。手順（管理者が行う。ワークフローから main へ直接 commit しない）:

```sh
# 1. X にタグを打つと release.yml が走る。run の id は URL（.../actions/runs/<id>）かリリースノートの「ビルドした run」から分かる
node scripts/evidence/fetch-run.mjs --run <run-id>                       # CI の成果物（JUnit・観察値・ci-summary・regression-selection）
node scripts/evidence/fetch-run.mjs --kind security --run <run-id>       # security の SARIF・SBOM・scan-run・findings・gate
node scripts/evidence/build-executions.mjs --run <run-id> --prune-other-versions --release <X>
# 2. docs/evidence/release.json を書く（X・イメージ digest・run id）
npm run evidence:build && npm run evidence:check   # release.json があるので、X で --strict の検査になる
# 3. これを commit Y として main に入れる（PR）。Y 以降の CI が、X の実施表を strict で検査し続ける
```

- 新しい検出（`FND-NEW-xxxxxx`）が出たら、`node scripts/security/assign-finding-ids.mjs --findings <findings.json> --write` で `security/finding-ids.yaml` に番号を振って commit する。
- CI の docs-check は、PR のたびに `check-evidence.mjs` と `npm run evidence:test` を回す。
- **成果物台帳の古さは、通常の CI では警告**。文書 PR を並列で出すと、`docs/*.md` を足すたびに台帳（`artifacts.yaml`）・manifest・追跡表などの生成物が古くなり、全 PR が再生成で衝突するため。台帳は最後に 1 回 `npm run evidence:build` で再生成し、`--strict-artifacts` で確かめる。まだ台帳に無い文書（main に入ったばかりの `docs/README.md` など）は警告になる（それで正しい）。

### リリースの release-evidence.zip の墨消しと差し替え

GitHub Release に添付する `release-evidence.zip` も、証跡の取り込みと**同じ墨消し**（`scripts/evidence/lib/redact.mjs`・`redact-rules.mjs`・`sensitive.mjs` を共有）を通す。

- `release.yml` の publish ジョブ: `scripts/ci/release-evidence.mjs` が zip に入れる前に墨消しし、`manifest.json` に `redacted: true`・`redaction`（変えたファイル数・置換数）・`redactions[]`（ファイルごとの元 sha256・墨消し後 sha256・規則ごとの件数）を残す。`files[].sha256` は墨消し後のファイル。
- 続けて `scripts/ci/check-release-evidence.mjs --zip release-evidence.zip` が zip の中身を検査する（メール・氏名のキー・メンション・オーナー名・秘密情報らしい値が 1 件でもあれば、または manifest の `redacted: true`・sha256 が合わなければ失敗）。失敗すると zip を artifact に保存せず、GitHub Release も作らない。
- ZAP の JSON のキー（`"@version"` など）はメンションと見なさない。

**既に公開した Release の添付を、墨消し済みの zip で差し替える**（管理者が手元で行う）:

```fish
# 元の run（タグの release.yml の run。URL の .../actions/runs/<id>）の artifact release-evidence を取得 → 墨消し → manifest 作り直し → zip → 検査
node scripts/ci/rebuild-release-evidence.mjs --run 38152472087 --out ~/tmp/release-v1.0.0
# 出力: ~/tmp/release-v1.0.0/release-evidence.zip と rebuild-report.json（検査が pass で、files_changed・replacements・元 / 墨消し後の zip の sha256 が入る）
node scripts/ci/check-release-evidence.mjs --zip ~/tmp/release-v1.0.0/release-evidence.zip --repo bsj-fujimoto/todo-app   # 単独で再検査してもよい
gh release upload v1.0.0 ~/tmp/release-v1.0.0/release-evidence.zip --clobber --repo bsj-fujimoto/todo-app
```

- `--from <dir>` を使うと、取得済みの artifact（`release-evidence.zip` を含むディレクトリ）から作り直せる。`<out>/original/` と `<out>/release-evidence/` に元の取得物（個人情報を含む）が残るので、commit せず、差し替え後に消す。
- 元の値は、Git 履歴・Actions の artifact（90 日）には残る（`docs/evidence/README.md` の制約）。差し替えるのは Release の添付だけ。
- **v1.0.0 の添付は 2026-10-12 に差し替え済み**（現在の sha256 `75d2fa5c9b741efa24c40bf96a73b9331b7d9aae6da80f7c817cda02ec97021e`、墨消し 584 箇所・11 ファイル。元の版は削除した。記録は `docs/evidence/README.md` の「リリースの添付」と `docs/13-evidence.md`）。

### 古い run の証跡の扱い（superseded）

実施表の基準を別の run に取り替えたあとも、前の run の証跡（`docs/evidence/runs/<run-id>/`）は履歴として残し、**消さずに印を付ける**。

- 印: その run の `SOURCE.json` に `superseded_by` を書く（`run_id`＝置き換えた run、`head_sha`、`reason`＝取り替えた理由と承認の根拠、`marked_at`＝印を付けた日）。`fetch-run.mjs` は書かない（人が書く。同じ run を取り込み直すと消えるので、取り直したら書き直す）。
- 反映: `build-manifest.mjs` が、その run の全ファイルの manifest の項目に `superseded_by: "<置き換えた run の id>"` を付ける。**実施表・証拠索引の根拠ではない**ことを機械で読める。証拠索引の既存の行（run 全体の証拠）は、主張の文面が対象 SHA を含むため書き換えない（EV の ID を変えない）。
- 現在の印: `runs/38128562945`（PR #26 の CI、対象 52da4aa、`pre-1.0.0`）は、v1.0.0 の Release run `38152472087`（対象 5fcf40a）に置き換えた（実施表の基準の取替。`docs/09-test-execution.md` の DEV-006）。

### 対象版でない run の扱い（role: history）と、実施表の kind

実施表には対象版（`release.json` の `commit_sha` = X）の run の結果だけを入れる。対象版でない run（別の commit・開発機での実行・未コミットの変更を含む実験・置き換えた旧 run）は、`docs/evidence/run-roles.yaml` で **`role: history`** とし、理由を残す（`build-run-roles.mjs` が commit と実行の状態から決める）。履歴の証跡は残すが、実施表・証拠索引の根拠にしない。`check-evidence.mjs` の `run-roles` 検査は、台帳が生成結果と一致し、実施表の `run_ref` がすべて `target` の run であることを確かめる。

- 実施表の `kind` は `regression`・`automated`・`manual`・`performance`。`performance` は perf 層の判定（`build-perf-executions.mjs`）。**監視（synthetic）とセキュリティの run は kind にしない**: 実施表の行は TC に結び付く結果で、これらは結び付くケースが無い（ケースの無い行を足すと、全ケースに行がある・追跡表で TC から実施に至る、という表の意味が崩れる）。結果は `docs/evidence/monitoring/`（`fetch-run.mjs --kind monitoring`）・`security/` に取り込む。
- 取り込み直し（`fetch-run.mjs`）で `perf/` が別の commit の run に置き換わると、`build-perf-executions.mjs` は実施表に行を足さず（スキップと表示）、`run-roles.yaml` がその run を履歴にする。

### SOURCE.json の読み方

- `version`: タグの run なら版（`v1.0.0` → `1.0.0`）、そうでなければ `pre-1.0.0`。ci の取り込みは `ci-summary.json` の `ref` から、`--kind security` などの取り込みは `gh run view` の `headBranch` から決める（`--sha`・`--url` で gh を使わないときは `--version` を渡す）。取り込み時に版を取り違えた場合は、`corrections` に変更前・変更後・理由・日付を残して直す（例: `docs/evidence/security/SOURCE.json` は、取得元が v1.0.0 の run なのに `pre-1.0.0` になっていたのを 2026-10-12 に直した）。
- `run_started_at`（`kind: ci`）: **`ci-summary.json` の `started_at`（集計ジョブの開始時刻）**で、GitHub の run の作成時刻（`gh run view` の `createdAt`）ではない。例: run 38152472087 は作成 15:43:26Z、`run_started_at` は 15:45:50Z（下流の集計ジョブが始まった時刻）。run 全体の開始・終了は `gh run view <id> --json createdAt,updatedAt` で見る。
- `captured_at`: 取り込んだ（`fetch-run.mjs` を実行した）時刻。run の実行時刻ではない。
- `attestations/` の SBOM・provenance は、レジストリに付いた署名済みの原本の**写し**で、墨消し後は原本と一致しない（原本は `docker buildx imagetools inspect <image>@<digest>` と `gh attestation verify` で取る）。

### 再生成の冪等性

- `executions.csv`: 同じ run の行は置き換える。EXEC-0001 形式の ID は（run, TC, 環境）が同じなら引き継ぐ。別の版の行が残るときは失敗（`--prune-other-versions` で捨てる）。
- `evidence-index.csv`: EV-0001 は（参照, 主張）の組で固定。実施表・不具合表から参照されなくなった実施由来の EV は落とす。
- `defects.csv`: 取得した Issue が前回と同じなら、スナップショットも取得時刻も書き換えない。`--offline` はコミット済みのスナップショットだけで同じ表を作る。
- `manifest.json`・`artifacts.yaml`: 内容が同じなら変わらない（`--check` で確かめられる）。

## 3. 各スクリプト

| スクリプト                  | 役割                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch-run.mjs`             | artifact を 1 つずつ取り（`*.dockerbuild` は除く）、小さな成果物だけを `docs/evidence/` へ。`SOURCE.json` を作る。`--kind ci / security / perf / monitoring / github`                                                                                                                                                               |
| `build-executions.mjs`      | JUnit・観察値・`ci-summary.json`・`regression-selection.json` から実施表。1 行 = 1 ケース × 1 実行環境 × 1 run。全ケースに 1 行以上（無ければ `not_run` + 理由）。手動ケースは実施していなければ `not_run`（理由・owner・予定日は `docs/evidence/manual-plan.yaml`）                                                                |
| `build-perf-executions.mjs` | 取り込み済みの `docs/evidence/perf/`（perf 層の `verdict.json`）から、実施表に kind=performance の行を足す。結び付けは `perf/slo.yaml` の `test_cases`。対象版（`release.json`）の run だけ（別の commit の run は足さない）。同じ run の行は置き換える（冪等）                                                                     |
| `build-deviations.mjs`      | `docs/09` の DEV 表（正本）→ `docs/data/deviations.csv`。承認の根拠は表のとおり。`--check` で一致の確認。表と CSV のずれは `check-parity.mjs` が検知する                                                                                                                                                                            |
| `build-api-results.mjs`     | `backend/test/api-tags.yaml`（TC → endpoint・method・タグ）と、取り込んだ run の JUnit・観察値、テストの実装（`backend/test/api/*.test.js`。アサート・契約検証の有無）→ `docs/data/api-results.csv`。タグの裏付けが観察値に無い・実測に無い endpoint・対応表に無い API 層のケースは失敗。`--check` で一致の確認                     |
| `build-run-roles.mjs`       | `docs/evidence/run-roles.yaml`。取り込んだ run の `SOURCE.json` と `perf/results/*/run.json` を、対象版（`release.json`）の結果（target）か履歴（history）に分ける。履歴は実施表の根拠にしない。`--check` で一致の確認                                                                                                              |
| `build-defects.mjs`         | Issue（`defect`・`flaky`）→ `defects.csv`。本文は `.github/ISSUE_TEMPLATE/defect.md` の見出しと「- キー: 値」を読む。語彙を統一し、欠けた項目は Issue 番号つきで指摘して失敗する（事実に基づいて Issue 本文を補筆してから再実行）                                                                                                   |
| `build-findings.mjs`        | security の `findings.json` → `findings.csv`。finding_id は triage が振った安定 ID `FND-nnn`（FND を docs/data の中で定義する。未登録の仮 ID があれば失敗）。run の出力に owner・due が無い検出は、現在の `security/triage.yaml` の同じ検出への記載から owner・due だけを補う（status など run の判定は変えない。台帳に無ければ空） |
| `build-evidence-index.mjs`  | 証拠索引。run 全体・セキュリティ（検出 1 件ごと）・性能・監視・GitHub 統制の証拠を足し、全参照（ファイル・アンカー・sha256）を検査                                                                                                                                                                                                  |
| `build-traceability.mjs`    | REQ → RISK → VIEW → TC → EXEC → DEF → FND → ACT。ケースに結び付かない要求・リスク・観点・検出・アクションは `gaps` つきの行で残す                                                                                                                                                                                                   |
| `build-manifest.mjs`        | `docs/evidence/manifest.json`（path / sha256 / size / captured_at / source / version / head_sha）                                                                                                                                                                                                                                   |
| `verify-manifest.mjs`       | 全ファイルを再計算して、不一致・欠落・未登録を検出（改変検知）                                                                                                                                                                                                                                                                      |
| `build-artifacts.mjs`       | `artifacts.yaml`（文書ごとの版・状態・承認・履歴・sha256・保存方針）と `source-of-truth.yaml`。文書のヘッダ表と `git log` から作る                                                                                                                                                                                                  |
| `check-parity.mjs`          | md の「N 件（TC）」と表の行数、「`cases.csv` の列: …」と実際の列を突き合わせる                                                                                                                                                                                                                                                      |
| `check-evidence.mjs`        | 上をまとめて検査（CI の docs-check 向け）。`--out report.json`・`--release <SHA>`・`--strict`・`--strict-artifacts`（台帳の古さも失敗）・`--structure-only`（release.json を見ない構造検査）。`docs/evidence/release.json` があれば X を `--release` に `--strict`                                                                  |

## 4. 設計判断と制約

- **観察値と JUnit が正本**。`actual_result` は観察値だけから組む（期待結果は読まない）。観察値が無い行は「観察値なし」と書き、JUnit が記録した事実（件数・結果・所要）だけを添える。期待結果と同一なら失敗、全文を含む・短すぎるものは警告。
- `kind`: `pull_request` の run は `automated`、それ以外（push・schedule・dispatch・release）の全件回帰は `regression`、手動ケースは `manual`。`status` は `pass / fail / blocked / not_run / skipped`（小文字）。
- 版の混在: 実施表の `commit_sha` は 1 種類。観察値・ci-summary・SOURCE.json の SHA と run id も突き合わせる。JUnit の層ごとの件数が `ci-summary.json` と違うときも失敗（取り込み漏れ・別 run の混入）。
- `finding_id` は security の triage が、fingerprint から決まる**安定 ID**（`FND-nnn`。台帳 `security/finding-ids.yaml`）で振る。検出が増減しても同じ検出は同じ番号を保つ。
  台帳に無い新しい検出は仮 ID（`FND-NEW-xxxxxx`）で出て、`build-findings.mjs` が失敗する。`node scripts/security/assign-finding-ids.mjs --findings <findings.json> --write` で番号を振って commit してから取り込み直す
  （旧形式の `F-001` の findings.json も `FND-001` に写せる）。
- `artifacts.yaml` の履歴・更新日時は**コミット済み**の内容から作る。文書を更新したら、コミット後に `build-artifacts.mjs` を再実行する（古ければ `check-evidence.mjs` が警告、`--strict-artifacts` で失敗）。
- 検出したのがテストケースでない不具合（CodeQL・外形監視など）は、Issue の「関連ケース」に「ケース: 該当なし。…」と、検出した手段・ケースが無い事実・新規ケースの案を書く。`case_ids` は空になり、`check-evidence` は警告、追跡表には「関連ケースがない」の行（gaps）で残る。ケースがあるのに書かない場合は指摘して失敗する。
- `build-defects.mjs` の `release` は、起票日以前で最新の `v*` タグ（無ければ `pre-1.0.0`）。`source` は検出工程が production なら production、それ以外は test。
- **墨消し**: `fetch-run.mjs`（と、Issue のスナップショットを作る `build-defects.mjs`）は、取り込んだテキスト（JSON・SARIF・jsonl・md・xml…）から、人の氏名・メール・アカウント名・秘密情報らしい値を決定的に `[REDACTED:…]` へ置き換える（`lib/redact.mjs`）。記録は `SOURCE.json` の `redactions`（理由・規則ごとの件数・元ファイルと墨消し後の sha256）。manifest の項目には `original_sha256`・`redacted: true`。`check-evidence` の簡易検査は**許可リストの例外なし**で、墨消し漏れ（メール・メンション・オーナー名・墨消し済みでない author / email キー）を失敗にする。取り込み済みの証跡を墨消しし直すときは、同じ `fetch-run.mjs --run <id>` を再実行する。
- 正規表現による秘密情報・個人情報の検査は**不在を証明しない**（`docs/evidence/README.md`）。
- 取り込むのは小さな実行成果物だけ。失敗時の trace・video・HTML レポートは持ち込まない。

## 5. テスト

```sh
npm run evidence:test   # node:test（固定の入力・時刻なし）。CI では scripts の他のテストと一緒に回す
```
