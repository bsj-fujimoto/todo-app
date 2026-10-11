# security/ — セキュリティ検査の方針と台帳

検査の実体は `.github/workflows/security.yml`（PR・main push・週次・手動・release から再利用）。
マージの可否は集約ジョブ **`security-result`** だけが決める（Ruleset の required check）。

## 検査の一覧

| 検査           | ツール（版は `tools.env` で digest 固定）                                           | 設定ファイル                                        | 出力（artifact に 90 日保存）                  | 失敗の条件                                                    |
| -------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| SAST           | CodeQL（javascript-typescript、security-extended）                                  | `codeql-config.yml`                                 | SARIF（Code Scanning にもアップロード）        | triage のゲート                                               |
| Secret         | gitleaks（git 履歴全体）                                                            | `gitleaks.toml`                                     | SARIF（値は伏字）                              | triage のゲート。履歴を 1 commit も読めなければ失敗           |
| SCA            | npm audit（`--omit=dev` と全体）、osv-scanner                                       | —                                                   | JSON / SARIF                                   | triage のゲート                                               |
| SBOM           | `npm sbom`（npm 組み込み）、trivy（イメージ）                                       | —                                                   | CycloneDX JSON（実行時依存 / 全体 / イメージ） | 生成できなければ失敗                                          |
| Container/IaC  | trivy（fs: vuln,misconfig,secret / image ×2）、hadolint、compose-check              | `hadolint.yaml`、`scripts/security/lib/compose.mjs` | JSON / SARIF                                   | triage のゲート                                               |
| License        | 自前の評価（`license-check.mjs`。lock と node_modules の license を読む。依存ゼロ） | `license-policy.yaml`                               | JSON                                           | 許可リスト外が 1 つでもあれば失敗（deny by default）          |
| DAST           | OWASP ZAP（baseline + API 走査。認証なし）                                          | `zap-rules.tsv`                                     | JSON / SARIF / HTML / Markdown                 | triage のゲート                                               |
| ワークフロー   | actionlint、`check-workflows.mjs`（W1〜W10）                                        | `workflow-policy.yaml`                              | JSON                                           | 逸脱があれば失敗                                              |
| 保守性         | ESLint（複雑度・大きさ・引数・ネスト・純粋性。`eslint-maintainability.mjs`）        | `eslint.config.js`                                  | SARIF・thresholds.json・summary.json           | 規約違反が 1 件でもあれば失敗（`maintainability` ジョブ）     |
| アーキテクチャ | `check-arch.mjs`（import 文からレイヤー依存・循環を検査。依存ゼロ）                 | `architecture.yaml`                                 | arch.json                                      | 向きの違反・許可外の依存・未分類のファイル・循環があれば失敗  |
| 公開物の検査   | trivy（release.yml が公開した digest に対して。脆弱性 + 設定）                      | `tools.env`                                         | JSON / SARIF（digest 入りの scan-run.json）    | 公開物の critical / high の未解決は失敗（Release を作らない） |
| 依存レビュー   | actions/dependency-review-action（PR のみ）                                         | `security.yml` の `allow-licenses`（方針の写し）    | PR の依存差分                                  | high 以上・方針外ライセンス                                   |
| Scorecard      | OpenSSF Scorecard（週次のみ）                                                       | —                                                   | SARIF                                          | 情報提供のみ（ゲートに含めない）                              |

どの検査も `scripts/security/scan.sh <検査名>` で **CI とローカルが同じコマンド**を実行する（再現できる）。出力は `security-results/<検査名>/` に置かれ、
検査ごとに `scan-run.json`（対象リポジトリ・branch・commit SHA・イメージ digest・実行日時・ツール名と版・コマンド・設定ファイル・走査範囲と除外・しきい値・出力ファイルの sha256）を残す。
SARIF には同じ情報（`versionControlProvenance`・`invocations`）を追記するので、SARIF 単体でも「何を・いつ・どのコマンドで」検査したかが追える。

- イメージ digest: security.yml の検査（`trivy-image-*`）はビルド直後のローカルイメージ ID（config digest）を記録する。**公開物そのもの**は release.yml が、push 後のレジストリ digest（dry-run は OCI アーカイブ）を pull して trivy（脆弱性 + 設定）で検査し、検査した digest を `target.image_digest` に入れた scan-run.json と SARIF を `release-evidence/published-scans/` に残す（`release-evidence.zip` と artifact `release-published-scans`。triage の結果は `published-scans-findings/`。期待する検査は `expected-published-scans.yaml`）。critical / high の未解決があれば GitHub Release を作らない。
- DAST の範囲: 本アプリは認証・認可を持たない（REQ-015）ので、認証なしの走査が全攻撃面。API は `backend/openapi.yaml` の全 operation を ZAP の API 走査に渡す。
- 実行しない検査とその理由は `scan-run.json` の `status: skipped` と `skipped_reason` に残る。`expected-scans.yaml` にある検査が欠けたら triage が失敗する。

## 重大度ポリシーと SLA

| 重大度   | 扱い                                                                                                                      | 是正の期限（SLA）              |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| critical | **未解決は失敗**（ゲートで止める）。受容できない（直す）                                                                  | 7 日                           |
| high     | **未解決は失敗**。やむを得ず受容するなら 30 日以内の期限付き                                                              | 30 日                          |
| medium   | 失敗にはしない。main / 週次で **Issue（ラベル `security`）を自動起票**し、修正するか `accepted-risks.yaml` で期限付き受容 | 90 日                          |
| low/info | 記録のみ（`findings.json` に残る）                                                                                        | 次の依存更新・リファクタのとき |

重大度の決め方: SARIF の `security-severity`（CVSS）があればそれ（9.0 以上 critical / 7.0 以上 high / 4.0 以上 medium / それ未満 low）。無ければ SARIF の level（error=high / warning=medium / note=low）。
hadolint（Dockerfile の書き方）は脆弱性ではないので 1 段下げる。ZAP は `zap-rules.tsv` の `FAIL` を high 以上として扱う。

## トリアージの規則

`scripts/security/triage.mjs` が全検査の出力を読み、`findings.json` を作る。

- **機械が決めること**: 重複排除（指紋 = ツール + ルール + 場所（行番号なし）+ 部品。別のツールが同じ勧告 ID（CVE/GHSA）× 同じ部品を出したら `dup`）、前回 run との差分（`new` / `persistent` / `fixed`）、受容の期限切れ、ゲート判定。
- **人が決めること**（`triage.yaml` / `accepted-risks.yaml` に書く。**機械は作り話を足さない**。書かれていない検出は `untriaged` のまま残り、critical/high ならゲートで止まる）:
  真陽性か（`tp`）・誤検出か（`fp`）・該当しないか（`na`）、到達可能性・公開範囲・資産影響・補完統制、修正方法・代替案・owner（ロール）・期限・再検査条件。
- ステータス: `tp`（真陽性・要是正）/ `fp`（誤検出）/ `dup`（重複）/ `accepted`（期限付き受容）/ `fixed`（前回あって今回無い）/ `na`（該当しない）/ `untriaged`（未判断）。
- ゲート: critical/high で `untriaged` または `tp` が 1 件でもあれば失敗。受容は high が 30 日・medium が 90 日まで（critical は受容不可）で、期限が切れたら未解決に戻る。
- `findings.json` の `finding_id` は並び順ではなく fingerprint から決まる安定 ID（`finding-ids.yaml`）。`docs/data/findings.csv` の `FND-nnn` と同じ。
- `fixed` は「前回の `findings.json`（main の直近の成功 run）にあって、今回は検出されない」ことで機械が付ける。再検査して消えたことが根拠。

### 再検査の条件

- 修正の PR は、その PR の security.yml の再実行で検出が消えること（`fixed`）をもって完了とする。
- `fp` / `na` / `accepted` の検出は、台帳の `reverify_condition`（例: 依存の更新時・期限の 7 日前・該当コードの変更時）で見直す。
- 週次の run（月曜）が、台帳と実際の検出のずれ（`stale_ledger_entries`）を出す。解消した検出の台帳エントリは外す。

### medium の Issue 起票（file-security-issues）

`security.yml` の `file-security-issues` ジョブは、PR 以外（main push・週次・手動）で動く。以前は main push のたびに skipped だった: `inputs.create_issues` は `workflow_call` のときだけ値を持ち、push・schedule では空文字で、`'' != false` は両辺が数値 0 に変換されて偽になるため。現在の条件は `format('{0}', inputs.create_issues) != 'false'`（release.yml が `create_issues: false` を渡したときだけ止まる）。
起票は指紋（fingerprint）単位で重複しない: 同じ指紋の open Issue があれば新規には作らず、週次の run だけ経過をコメントに追記する。同じ指紋の closed Issue があるのに検出が再発したときは、新規ではなく reopen してコメントする。

## 保守性とアーキテクチャの記録

- **保守性**（`scripts/security/eslint-maintainability.mjs`）: ci.yml の lint と同じ `eslint.config.js` のうち、複雑度（complexity ≤ 8・max-depth ≤ 3）・大きさ（関数 ≤ 40 行・ファイル ≤ 250 行）・引数（≤ 4）・純粋性（Date.now・Math.random・crypto.randomUUID・引数なしの new Date の直接呼び出しの禁止）のルールだけを SARIF にし、`thresholds.json`（ルールごとの閾値と分類）・`summary.json`（分類ごとの件数）を残す。scan-run.json は `check_kind: maintainability`・`rule_classes`（complexity / size / params / purity）・`thresholds`・`exclusions`・`command`・対象 commit を持つ。除外は、テストの行数ルール緩和・composition root と `scripts/*/*.mjs` 入口の純粋性ルールの免除・`ignores`（生成物）。違反が 1 件でもあれば `maintainability` ジョブが失敗する。
- **アーキテクチャ**（`scripts/security/check-arch.mjs`、規則は `architecture.yaml`）: backend / frontend の import 文（静的・re-export・動的）から、ファイル間の依存を取り、レイヤーの向き（`may_depend_on`）・外部依存（`allow_external`）・どのレイヤーにも属さないファイル・解決できない import・ファイル間の循環を検査する。backend は entry（main・config）→ app → web（routes・http）→ domain → kernel（errors）、store → domain → kernel。domain は他のレイヤーに依存しない（kernel のエラー定義だけは使う。外部依存なし）。frontend は entry → app・view・api・core、app と view は core だけ、api と core は何にも依存しない。結果は `arch.json`（レイヤーとファイル・レイヤー間の依存の本数・違反・循環・config_ref・対象 commit）。
  - 依存の向きを緩める変更は設計の変更として PR に理由を書く。ファイルを足したら `architecture.yaml` の `paths` に置き場を決める（未分類は失敗）。

## Code Scanning と台帳の突き合わせ

`scripts/security/check-code-scanning.mjs`（`triage` ジョブ。`security-events: read`、GET のみ）が、GitHub の Code Scanning のアラートと `accepted-risks.yaml` を突き合わせる。
台帳に無い open のアラート・台帳に無いのに dismissed のアラート・台帳にあるのに open のアラート・dismissed のコメントに AR-ID が無いもの・期限切れの受容は失敗にする（API を読めないときは「確認できなかった」と表示して成功扱いにしない）。
受容した検出に対応するアラートは、GitHub 側で dismissed にし、コメントに AR-ID・期限・Issue を書く（手順: `gh api -X PATCH repos/<owner>/<repo>/code-scanning/alerts/<番号> -f state=dismissed -f dismissed_reason="won't fix" -f dismissed_comment="AR-001 期限 2027-01-01 Issue #N"`）。

## 依存マニフェストの機械検査（check-policy）

`check-policy.mjs` は追跡ファイルから全マニフェスト（package.json・Dockerfile*・compose・composite action）を列挙し、次を検査する（漏れ・食い違いは CI が失敗）。

- **Dependabot の網羅**: `.github/dependabot.yml` が npm・docker・docker-compose・github-actions の全ディレクトリを覆っていること。マニフェストが無いディレクトリを指す古い記載も失敗にする。
- **依存の選定記録**: `dependency-selection.yaml` が、全 package.json の直接依存（名前と版）と、全 Dockerfile・compose のベースイメージ（リポジトリと digest）と一致すること。記録の無い依存・版の食い違い・digest の食い違い・どこにも無い古い記載・digest で固定されていないイメージは失敗。Playwright のイメージの版は `playwright-core` の版と同じであること。

## 台帳・方針ファイル

| ファイル                        | 内容                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `triage.yaml`                   | 検出ごとの判断・文脈・是正案（人が書く）                                                                                                                                               |
| `accepted-risks.yaml`           | 期限付き受容（id・理由・owner・受容日・期限・再検査条件）                                                                                                                              |
| `zap-rules.tsv`                 | ZAP のしきい値と除外（IGNORE は理由・owner・期限が必須。`check-policy` が検査）                                                                                                        |
| `license-policy.yaml`           | 許可・禁止ライセンス、期限付きの例外                                                                                                                                                   |
| `workflow-policy.yaml`          | ワークフローの write 権限・OIDC を許してよいジョブの許可リスト                                                                                                                         |
| `finding-ids.yaml`              | 検出の安定 ID（fingerprint → `FND-nnn`）。検出が増減しても同じ検出は同じ番号。新しい検出は `assign-finding-ids.mjs` で番号を振って commit（CI は未登録を仮 ID `FND-NEW-…` にして警告） |
| `expected-scans.yaml`           | 走るべき検査の一覧（欠けたら失敗）                                                                                                                                                     |
| `expected-published-scans.yaml` | release.yml が公開した digest に対して走るべき検査の一覧                                                                                                                               |
| `architecture.yaml`             | レイヤー依存の宣言（レイヤーのパス・依存してよいレイヤー・許可する外部依存）                                                                                                           |
| `dependency-selection.yaml`     | 直接依存の選定理由・検討した代替・保守状況・扱い（180 日ごとに見直す）                                                                                                                 |
| `tools.env`                     | 検査ツールのイメージ（tag + digest）                                                                                                                                                   |

`scripts/security/check-policy.mjs` がこれらの形式・期限を検査する（期限切れ・必須項目の欠落は CI が失敗）。

## ワークフロー統制の自動検査（W1〜W10）

`scripts/security/check-workflows.mjs` が全ワークフローと composite action を検査し、逸脱で失敗する。
W1 permissions を明示・最小（直下は read のみ）/ W2 action はコミット SHA で固定 / W3 `pull_request_target` 不使用 / W4 全ジョブに timeout /
W5 concurrency / W6 `continue-on-error` なし / W7 フォーク PR に secret を出さない / W8 OIDC（`id-token: write`）は許可したジョブだけ /
W9 PR タイトル等の信頼できない値を `run` に直接埋め込まない / W10 write 権限は許可リストのジョブだけ。

## ローカルでの再現

```sh
# 要: docker、mise（node 24）、npm ci 済み
bash scripts/security/scan.sh gitleaks      # 秘密情報（git 履歴）
bash scripts/security/scan.sh npm-audit     # npm audit（2 本）
bash scripts/security/scan.sh trivy-fs      # trivy fs
bash scripts/security/scan.sh license       # ライセンス方針
bash scripts/security/scan.sh workflows     # ワークフロー統制 + 方針ファイル（Dependabot の網羅・依存の選定記録を含む）
bash scripts/security/scan.sh maintainability  # 保守性（ESLint の閾値と違反）
bash scripts/security/scan.sh arch          # レイヤー依存・循環
node scripts/security/check-code-scanning.mjs --repo bsj-fujimoto/todo-app   # Code Scanning と台帳（要: gh のログイン）
node scripts/security/triage.mjs --results security-results --out security-findings   # トリアージ
```

## ツールの更新

`tools.env` の IMAGE と VERSION を、`docker buildx imagetools inspect <image>:<tag>` で確認した digest ごと書き換える（レビュー対象）。
GitHub Actions の action は Dependabot（github-actions）が SHA 固定のまま更新を提案する。

## 初回の検査で出た検出と処理（2026-10-11、PR #19 の run）

初回の security.yml は **46 件**（重複排除後。critical 0 / high 10 / medium 17 / low 12 / info 7）を検出した。握りつぶさず、次のとおり処理した（処理後の run は 9 件: medium 2〔受容〕/ low 2 / info 5、ゲート pass）。

| 検出                                                                                              | 件数                       | 処理                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| backend イメージに同梱された npm の依存（brace-expansion・undici・tar・ip-address など）の勧告    | high 8 / medium 12 / low 1 | **修正**: 実行イメージから npm・corepack・yarn を取り除いた（`backend/Dockerfile`）。fixed                                     |
| frontend イメージの libtiff（CVE-2026-4775）                                                      | high 1                     | **修正**: nginx-unprivileged の slim 版に変更（libgd・libtiff を含まない）。fixed                                              |
| frontend/Dockerfile に USER が無い（trivy DS-0002）                                               | high 1                     | **修正**: `USER 101` を明示。fixed                                                                                             |
| CodeQL js/file-system-race（`scripts/ci/lib/artifacts.mjs`・`scripts/security/lib/scan-run.mjs`） | high 2                     | **修正**: stat → read をやめ、1 回の操作で判定する。fixed                                                                      |
| ZAP 10055 CSP のディレクティブ不足                                                                | medium 1                   | **修正**: `base-uri` `form-action` `frame-ancestors` を追加（`frontend/nginx.conf`）。fixed                                    |
| ZAP 10063・90004（Permissions-Policy・COOP・CORP・COEP が無い）                                   | low 5                      | **修正**: ヘッダを追加。fixed                                                                                                  |
| compose-check COMPOSE-007（cap_drop・no-new-privileges が無い）                                   | low 2                      | **修正**: 両サービスに `cap_drop: [ALL]` と `no-new-privileges` を追加。fixed                                                  |
| hadolint DL3025・DL3066                                                                           | low 2 / info 1             | **修正**: HEALTHCHECK を exec 形式、USER を数値に。fixed                                                                       |
| zlib CVE-2026-85091（base イメージ。gz* API の溢れで、nginx も Node も使わない）                  | medium 2                   | **期限付き受容**（AR-001、2027-01-09、Issue #22）。到達不能。base の更新で消える                                               |
| ZAP 10049（API 応答がキャッシュ可能）                                                             | info 1 + na 2              | `tp`: backend が `Cache-Control: no-store` を付ける（owner: バックエンド担当、期限 2026-12-31）。残りの 10049-1・10049-2 は na |
| ZAP 100000・100001・10109、compose-check COMPOSE-006                                              | info / low 4               | `na`（理由は `triage.yaml`）                                                                                                   |

SCA（npm audit・osv-scanner）、Secret（gitleaks）、License は検出 0 件（License は MPL-2.0 と CC-BY-3.0 を期限付き例外として記録。`license-policy.yaml`）。

### 検査ツール自身の依存（供給網）の扱い

初回は SBOM に `@cyclonedx/cyclonedx-npm`、ライセンス検査に `license-checker-rseidelsohn` を使ったが、PR の dependency-review が
それらの推移依存（`nan`: DCO、`normalize-package-data`: JSON、`spdx-satisfies`: GPL-2.0-only を含む式）をライセンス方針違反として検出し、
`spdx-license-ids` などは Scorecard の警告（しきい値 3 未満）だった。**検査ツールが供給網リスクと方針違反を増やすのは本末転倒**なので、
SBOM は `npm sbom`（組み込み）、ライセンス評価は自作の依存ゼロ実装（`scripts/security/license-check.mjs`）に置き換えて、devDependency から外した
（インストールされるパッケージが約 260 減った）。MPL-2.0（axe-core）の例外は、E2E の開発依存として残っているので引き続き必要（期限付き）。CC-BY-3.0 の例外は不要になったので外した。
