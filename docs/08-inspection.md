# 08 テスト対象の検査結果レポート

| 項目 | 内容 |
|---|---|
| 文書ID | DOC-08 |
| 版 | 1.1 |
| 更新日 | 2026-10-12 |
| 状態 | draft（オーナーの確認待ち。PR マージ＝承認の代行） |
| 対象 | todo-app 仕様書 v1.1（spec/todo-phase1-spec.html）、リリース v1.0.0（commit 5fcf40a7e58dc253e53ff56860d0669a69abda26） |
| 作成 | セキュリティ担当（ロール。実作業は AI エージェント） |
| レビュー | 開発リード（未実施。作成者と同じ主体の兼務で、第二の目は無い。[ADR-0004](adr/0004-single-maintainer-governance.md)） |
| 承認 | プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ。オーナーの確認が済むまで draft のまま） |
| 正本 | この md と、`security/`（方針・台帳）、`.github/workflows/security.yml`、`scripts/security/`、`eslint.config.js`、`.github/settings/`・`.github/dependabot.yml`・`.github/CODEOWNERS`、`docs/data/findings.csv`・`actions.csv`、`docs/evidence/security/`（Git が版管理） |

この文書は、**v1.0.0 のコード・依存・構成・イメージ・GitHub の統制・公開面・構造を検査した結果と、その見方・判断・是正**をまとめる。ツールの生出力（SARIF・CycloneDX・`scan-run.json`・`findings.json`）は貼らず、`docs/evidence/security/` が正本である。表の行そのもの（検出 1 件ずつ）の正本は `docs/data/findings.csv` と `findings.json` で、本書は方針・集計・読み方・判断を書く。

## この文書の結論

- **v1.0.0 のゲートは pass**。検査 15 種（当時の期待 13 種の全部を含む）がすべて対象 commit で実行され、スキップ 0・欠落 0。**PR #57（2026-10-12 マージ）で保守性（maintainability）とアーキテクチャ（architecture）の検査が `security.yml` に加わり、`security/expected-scans.yaml` の期待は 15 種になったが、この 2 つは v1.0.0 の run の記録には無い**（次の run から）。重複排除後の検出は **12 件**（critical 0 / high 0 / medium 5 / low 2 / info 5）。ステータスは accepted 4 / na 6 / tp 1 / **untriaged 1**。前回 run との比較は新規 0・継続 12・解消 0（出典: `findings.json` の `summary`・`trend`、Release の run 38152472087）。
- **未解決は 6 件**（v1.0.0 の run の時点）: 期限付き受容 4 件（zlib の CVE が 2 イメージ分、CodeQL の結果ファイル書込みが 2 箇所。期限はいずれも 2027-01-09）、真陽性 1 件（API 応答に Cache-Control が無い。info。期限 2026-12-31）、**未判断 1 件**（gitleaks の medium。FND-012）。
- **未判断の 1 件（FND-012）は、筆者の検証では誤検出**（commit SHA と製品名のキーワードが同じファイルにあると働くルールに、検査証跡自身が当たった。再現実験あり）。v1.0.0 の run では台帳に無く **untriaged のまま**だったが、その後 `security/gitleaks.toml` の allowlist（PR #42）と `security/triage.yaml` の fp の記載（PR #57。owner セキュリティ担当・期限 2026-10-19。ACT-010）が入った。**main の `findings.csv` は v1.0.0 の run の結果なので untriaged のまま**で、次の `security.yml` の run で fp になる見込み（ACT-010 の確認待ち。inspection-16）。
- **GitHub の統制（Ruleset・ブランチ保護）は定義だけで、適用されていない**。2026-10-12 01:03 JST の実態は Ruleset 0 件、ブランチ保護なし。「期待する統制」と「実態」の差は inspection-13 に表で書いた。Actions 側（権限・SHA 固定・timeout ほか）は実効しており、自動検査（W1〜W10）が毎回 0 件で通る。
- **見つけた不備（本書の作成中に分かったこと）と、その後の対応**: ① medium を Issue にする自動起票（`file-security-issues`）が push で一度も動いていない、② Dependabot の version updates が 13 マニフェスト中 5 つを覆っていない、③ 依存の選定記録に 2 パッケージと 1 ベースイメージが無い、④ 検査したイメージと公開した digest はビルドが別で、同一性は未証明（再検査は同じ結果）、⑤ ESLint（単一責任・純粋さ）は CI で動くが検査記録（`scan-run.json`）に残していない、⑥ 構造（層の依存方向）の検査は CI に無い。**①〜⑥は PR #57（2026-10-12 マージ）で直った**（①は条件式の修正、②は 13/13、③は台帳 20 件と `check-policy` の照合、④は release.yml の公開 digest の trivy 検査〔次のリリースから〕、⑤⑥は `maintainability` ジョブの scan-run.json と `check-arch.mjs`）。CodeQL の 4 アラートも dismissed にし、FND-012 を台帳に追記した。残る依頼は末尾の表（状態の列）にまとめた。

### この文書の記録の時点

| 項目 | 内容 |
|---|---|
| 検査結果の出典 | v1.0.0 の Release run **38152472087**（2026-10-11 15:43〜15:45 UTC）。写しは **PR #42 が 2026-10-11T16:30:20Z に main へマージ済み**で、main の `docs/evidence/security/` と `docs/data/findings.csv`（12 件）は v1.0.0 の run のもの（以前は v1.0.0 より前の run 38126925868 で 9 件だった）。本書の件数は `findings.json` と `findings.csv` から数え直して一致を確認した（2026-10-12） |
| 実態の確認 | 2026-10-12 01:03〜01:20 JST に、`gh api`（読み取りのみ）、`scripts/ci/snapshot-github.sh`、`scripts/ci/apply-settings.mjs --dry-run`（変更しない）、`gh attestation verify`、`cosign verify` を実行 |
| 時間依存の事実 | 運用日数は 4 日未満（2026-10-11 開始）。Dependabot は 2026-10-11 に有効化、週次の定期 audit はまだ 1 回も走っていない。傾向・継続性は評価できない |
| 人名・アカウント | 本文はロール名で書く。`bsj-fujimoto/todo-app` は GitHub のリポジトリ座標で、人名の記載ではない |

## 検査の全体像

| 種別 | 検査（scan 名） | 実施 | ツール・版 | 結果（検出 / 未解決） |
|---|---|---|---|---|
| SAST | codeql | 実施 | CodeQL 2.27.2 | 4 件 → 2 件（medium、受容） / 2 |
| DAST | zap | 実施（認証なし） | OWASP ZAP 2.17.0 | 6 件（low 1・info 5） / 1（tp、info） |
| SCA | npm-audit-prod、npm-audit-all、osv-scanner、trivy-fs | 実施 | npm audit 11.19.0、osv-scanner 2.6.0、trivy 0.75.0 | 0 / 0 |
| SBOM | sbom（npm sbom）、イメージ SBOM（trivy ×2） | 実施 | npm 11.19.0、trivy 0.75.0 | CycloneDX 4 本 / — |
| Secret | gitleaks | 実施 | gitleaks 8.30.1 | 1 件（medium、未判断） / 1 |
| Container | trivy-image-backend・frontend、hadolint | 実施 | trivy 0.75.0、hadolint 2.15.1 | 2 件（zlib、受容）、hadolint 0 / 2 |
| IaC・構成 | compose-check（trivy-fs の misconfig を含む） | 実施 | compose-check 1.0.0（自前） | 1 件（low、na） / 0 |
| License | license | 実施 | license-check.mjs 1.0.0（自前） | 違反 0、期限付き例外 2 / 0 |
| Provenance・署名 | release.yml（attest・cosign） | 実施 | actions/attest-build-provenance、cosign（keyless） | 検証 pass（inspection-10） |
| ワークフロー統制 | actionlint、workflow-governance（W1〜W10） | 実施 | actionlint 1.7.12、check-workflows 1.0.0 | 0 / 0 |
| 依存レビュー | dependency-review | PR のみ | actions/dependency-review-action v5.0.0 | PR で実行（push では skipped） |
| Scorecard | scorecard | 週次のみ | OpenSSF Scorecard v2.4.4 | 実績なし（初回は 2026-10-12 19:00 UTC） |
| アーキテクチャ | architecture（`scripts/security/check-arch.mjs`。`security.yml` の `maintainability` ジョブ） | 実施（PR #57 から CI。**v1.0.0 の run の記録には無い**） | check-arch 1.0.0（自前。規則は `security/architecture.yaml`） | 違反 0・循環 0（2026-10-12 に手元で実行） |
| コード品質・単一責任・純粋さ | ESLint（CI の lint ジョブ。PR #57 から `maintainability` ジョブが scan-run.json・SARIF に記録） | 実施（記録は v1.0.0 の run には無い） | ESLint 10.12.0 | 0 件 |
| SEO・AIO | — | 対象外（承認の提案あり） | — | — |
| framework 規約 | — | 専用の検査なし（理由は inspection-22） | — | — |
| 依存選定 | `security/dependency-selection.yaml` + `check-policy` | 実施（台帳 + 期限検査 + package.json・Dockerfile・compose との照合） | 自前 | 台帳 20 件、欠落 0 件（PR #57。以前は 17 件・欠落 3 件） |

## inspection-01 対象・版・Digest

**結論**: 15 の検査はすべて同じ対象 commit・同じ branch（タグ v1.0.0）・同じ workflow で実行され、実行日時が残っている。**イメージ digest は 2 通りある**（検査したローカルイメージの ID と、公開した registry の digest）ので、両方を書く。同一性の確認は inspection-10 に書いた。

**対象リポジトリ**: `https://github.com/bsj-fujimoto/todo-app`（public）。

**branch**: `v1.0.0`（タグ。`refs/tags/v1.0.0`）。**commit**: `5fcf40a7e58dc253e53ff56860d0669a69abda26`（15 run すべてが一致。出典: 各 `scan-run.json` の `target.commit_sha` と SARIF の `versionControlProvenance`）。

**実行日時**: 2026-10-11 15:43:34Z（zap の開始）〜 15:45:13Z（zap の終了）。run は Release の 38152472087（`release.yml@refs/tags/v1.0.0` が `security.yml` を呼ぶ）。

| 検査 | 開始（UTC、2026-10-11） | commit | image digest（記録の種類） |
|---|---|---|---|
| actionlint | 15:43:35 | 5fcf40a7e58d… | — |
| codeql | 15:43:37 | 同上 | — |
| compose-check | 15:44:00 | 同上 | — |
| gitleaks | 15:43:35 | 同上 | — |
| hadolint | 15:43:58 | 同上 | — |
| license | 15:43:38 | 同上 | — |
| npm-audit-all / npm-audit-prod | 15:43:37 | 同上 | — |
| osv-scanner | 15:43:38 | 同上 | — |
| sbom | 15:43:49 | 同上 | — |
| trivy-fs | 15:43:43 | 同上 | — |
| trivy-image-backend | 15:44:19 | 同上 | `sha256:f0ab054b2955addb3496f1f3990caf55149708d997d7eed780bf6f57a951cc68`（CI でビルドした `todo-app-backend:ci` のローカル ID。config digest） |
| trivy-image-frontend | 15:44:22 | 同上 | `sha256:e698b13cf062a1ed2856c652a51f4c2bc0e53fb9a06aaf2b719392b85865d814`（`todo-app-frontend:ci` のローカル ID） |
| workflow-governance | 15:43:39 | 同上 | — |
| zap | 15:43:34 | 同上 | —（compose で起動した同じ commit のスタックを走査） |

**イメージ digest（公開したもの）**: backend `sha256:87addb2e3998f9c793e1c979f9b65d98d3cca98e1eea57be8c6ac28705f5a213`、frontend `sha256:c82e88bae5e0aeb7d04df9e31808d1d490cdc6bc01b98efe11db7cd9b526ee9a`（`ghcr.io/bsj-fujimoto/todo-app-backend` ・`todo-app-frontend`。Release v1.0.0 の本文と `docs/evidence/release.json`）。

**できていないこと**: v1.0.0 の SBOM・脆弱性検査の対象は `:ci` のローカルイメージで、公開した digest そのものではない（ビルドは別の job）。2026-10-12 に公開 digest を同じ trivy で再検査して同じ結果を得た。PR #57 で release.yml の publish ジョブが、push 後の digest を trivy（脆弱性 + 設定）で検査し、`target.image_digest` 入りの scan-run.json と SARIF を `release-evidence/published-scans/` に残す形（critical・high の未解決は Release を作らない）に変わったが、**v1.0.0 の公開には適用されていない**（v1.0.0 は PR #57 より前に公開済み。Release の dry-run run 38158428129 で動作を確認）。v1.0.0 については手動の再検査の結果に頼る（inspection-10・依頼表）。

## inspection-02 検査スコープ・非実施理由

**結論**: 期待する検査 8 種（sast / dast / sca / secret / container / config / license / maintainability。`docs/ai-context.yaml` の `inspection.expected_checks`。maintainability は PR #57 から記録）はすべて実施した（maintainability は v1.0.0 の run の記録には無く、次の run から）。非実施・対象外は下表の 9 件で、**承認があるのは inspection-12 の 1 件だけ**。ほかは「できていないこと」として理由・期限候補を書き、承認済みとは書かない。

**実施した検査**: 上の「検査の全体像」と `security/expected-scans.yaml`（現在 15 検査〔maintainability・architecture を PR #57 で追加。v1.0.0 の run の時点は 13 検査〕。欠けたら triage が失敗する）。v1.0.0 の実績は 15 run、skipped 0、missing 0（`findings.json` の `missing_scans: []`）。

| # | 非実施・対象外 | 理由 | 承認（ロール・日・期限） | 見直し・再検査の条件 |
|---|---|---|---|---|
| 1 | 認証済みの面の DAST | **認証・認可が無い**（REQ-015。`openapi.yaml` に security scheme も 401/403 も無い）ので、認証済みの面が存在しない。認証なしの走査が全攻撃面 | **承認なし**。`ai-context.yaml` の対象外台帳に inspection-07 の項目が無い（api-02 のみ）。次の改版で追加を提案 | 認証を導入するとき（導入前に） |
| 2 | SEO・AIO | 公開コンテンツサイトではない（inspection-12） | プロダクトオーナー（PR マージをもって承認。2026-10-12。AI の代行マージで、オーナーの確認は未実施）。期限 2027-04-12 | 公開 Web ページを足すとき |
| 3 | IaC の検査 | Terraform などの IaC ファイルが無い。Dockerfile は hadolint と trivy、compose は compose-check で扱う | 承認の対象外（そもそも対象が無い） | IaC ファイルを足すとき |
| 4 | perf/screen イメージの脆弱性検査 | 画面計測用（Playwright 公式イメージに Lighthouse）。公開物ではなく計測時に一度きり動かす。ただし trivy image の対象に入れていない（hadolint は対象） | **承認なし**（できていないこと）。提案: 期限 2026-12-31 までに trivy image を足すか、対象外として承認を取る | イメージを足す・計測を常用にするとき |
| 5 | 公開した digest に対する検査（v1.0.0） | v1.0.0 の publish job は、検査済みイメージとは別にビルドして push し、検査は `:ci` のイメージだった。PR #57 で release.yml が公開 digest を直接 trivy 検査する形になったが、v1.0.0 には適用されていない | **承認なし**（2026-10-12 に手動で再検査して一致を確認） | 次のリリースで公開物の検査が動いたとき |
| 6 | Scorecard の結果 | 週次（月曜 19:00 UTC）のみ。初回がまだ来ていない。情報提供でゲートに含めない | —（まだ実績が無いだけ） | 初回の週次 run（2026-10-12 19:00 UTC）の後 |
| 7 | 人による診断（ペネトレーションテスト） | 未実施（`docs/01-test-plan.md` の plan-14 も未実施と記す） | **承認なし** | 外部に公開する決定をしたとき |
| 8 | 重複コードの検出・性能の静的検査 | 該当するツールを入れていない。性能は perf 層（k6）の動的試験で見る | **承認なし** | 保守対象が増えたとき |
| 9 | gitleaks の PR 参照（`refs/pull/*`）の走査 | CI の走査範囲は branch と tag（checkout の fetch-depth 0）。PR の参照は含まない | —（範囲の宣言。inspection-05） | — |

**ai-context.yaml との食い違い（解消済み）**: 以前の同ファイルは `maintainability`（ESLint）を「検査結果の対象にしていない」、`framework` を「React 等を使っていない」ので対象外と書き、本書（ESLint は inspection-19〜21、backend は Fastify を使う inspection-22）と食い違っていた。横断整合の PR（2026-10-12）で、`maintainability` を `expected_checks` に含め、`framework` は `not_expected`（Fastify 用の専用 lint・規約検査は無い、という理由つき）に残して本書と揃えた。

## inspection-03 ツール・Rule・Threshold

**結論**: ツールはすべて版が固定され、設定ファイルは Git で管理され、変更は CODEOWNERS（`/.github/` と既定の `*`）によりレビュー対象になる。検査ツールのイメージは **tag + digest** で固定（`security/tools.env`）。しきい値は重大度ポリシーで一元化している。

| 検査 | ツール・版（イメージ digest の先頭） | 設定 | ルール | 除外 | しきい値 |
|---|---|---|---|---|---|
| codeql | CodeQL 2.27.2（`github/codeql-action` v4.38.3、SHA 固定） | [codeql-config.yml](../security/codeql-config.yml) | `security-extended`（実行した 103 クエリ） | node_modules・dist・coverage・test-results・playwright-report・security-results | high 以上の未解決で失敗 |
| gitleaks | 8.30.1（`sha256:c00b6bd0aeb3`） | [gitleaks.toml](../security/gitleaks.toml) | 組み込みの全ルール（`useDefault = true`） | **無し**（allowlist 0 件） | 検出は triage で判定 |
| npm-audit | npm 11.19.0 | `package-lock.json` | `--omit=dev` と全体の 2 本 | — | high 以上で失敗 |
| osv-scanner | 2.6.0（`sha256:afd838850ac1`） | — | `scan source -L package-lock.json` | — | high 以上で失敗 |
| trivy（fs・image） | 0.75.0（`sha256:af6acf9a6b85`） | — | fs は vuln・misconfig・secret、`--include-dev-deps` | `node_modules`・`.cache`・`security-results`・`.git` | high 以上で失敗 |
| hadolint | 2.15.1（`sha256:32dac94127fd`） | [hadolint.yaml](../security/hadolint.yaml) | 既定。`failure-threshold: warning` | `ignored: []`（0 件） | warning 以上 |
| compose-check | 1.0.0（`scripts/security/lib/compose.mjs`） | — | COMPOSE-001〜008 の 8 ルール | — | triage |
| license | license-check.mjs 1.0.0 | [license-policy.yaml](../security/license-policy.yaml) | 許可 11 種 + 禁止パターン 9 個。**許可リスト外はすべて違反**（deny by default） | 期限付き例外 2 件（MPL-2.0。期限 2027-04-11） | 違反 1 件でも失敗 |
| zap | 2.17.0（`sha256:7aaa659b0d43`） | [zap-rules.tsv](../security/zap-rules.tsv) | baseline + API 走査。しきい値の記載は **0 行**（IGNORE・FAIL なし。全ルールが WARN 扱い） | なし | FAIL は high 扱い（現在 FAIL 指定なし） |
| actionlint | 1.7.12（`sha256:b1934ee5f1c5`） | — | 既定 | — | 1 件でも失敗 |
| workflow-governance | check-workflows 1.0.0 | [workflow-policy.yaml](../security/workflow-policy.yaml) | W1〜W10 | 許可リスト（理由付き） | 逸脱 1 件で失敗 |
| ESLint | 10.12.0（`@eslint/js` 10.0.1） | [eslint.config.js](../eslint.config.js) | 推奨 + 規約（inspection-20・21） | 生成物・依存・security-results ほか | error で失敗（warning は設けない） |

**重大度の決め方**（[security/README.md](../security/README.md)）: SARIF の `security-severity`（CVSS）があればそれ（9.0 以上 critical / 7.0 以上 high / 4.0 以上 medium / それ未満 low）。無ければ SARIF の level（error=high / warning=medium / note=low）。hadolint は脆弱性ではないので 1 段下げる。ZAP は `FAIL` を high 以上として扱う。**ツールの値で機械が仮決めし、文脈（到達可能性ほか）は人が台帳に書く**（inspection-17）。

**設定の変更履歴**: すべて Git（PR 単位）。ツールの更新は `tools.env` の IMAGE と VERSION を digest ごと書き換える手順で、差分がレビュー対象。

## inspection-04 再現性

**結論**: すべての検査は `scripts/security/scan.sh <検査名>` を CI とローカルで同じように実行する。出力は `security-results/<検査名>/`、artifact に 90 日保存。**再実行して同じ結果になることを、2026-10-12 に 4 通りで確認した**。

**コマンド**:

| 検査 | コマンド（リポジトリのルートで） |
|---|---|
| ワークフロー統制 | `bash scripts/security/scan.sh workflows`（`actionlint` は `scan.sh actionlint`） |
| ライセンス | `bash scripts/security/scan.sh license` |
| npm audit | `bash scripts/security/scan.sh npm-audit` |
| 秘密情報 | `bash scripts/security/scan.sh gitleaks`（要 docker。git 履歴を 1 commit も読めなければ失敗にする） |
| SBOM・osv・trivy・hadolint・compose・zap | `scan.sh sbom` / `osv` / `trivy-fs` / `trivy-image <backend\|frontend> <image>` / `hadolint` / `compose-check` / `zap` |
| トリアージ（重複排除・台帳・前回差分・ゲート） | `node scripts/security/triage.mjs --results security-results --out security-findings` |
| 台帳・方針ファイルの形式と期限 | `node scripts/security/check-policy.mjs` |

**workflow**: [security.yml](../.github/workflows/security.yml)（PR・main への push・週次・手動・release から再利用）。ゲートは集約ジョブ `security-result`（Ruleset の required check の定義）。**config**: 上の inspection-03 の表。**output location**: `security-results/<検査名>/`（artifact `security-scan-*`・`security-findings`）、リリースでは `release-evidence.zip`。各検査の `scan-run.json` に、コマンド・設定・走査範囲・除外・しきい値・出力ファイルの sha256 が残る。

**再実行の結果（2026-10-12 JST）**:

| 再実行 | 方法 | 結果 |
|---|---|---|
| トリアージ | v1.0.0 の run の検査出力（15 検査分）に、同じ台帳で `triage.mjs` をかけた | **同じ 12 件・同じ指紋・同じステータス・ゲート pass**（fingerprint と status・severity・rule_id の対応が完全一致） |
| 公開イメージの脆弱性 | 公開 digest 2 つに、同じ trivy 0.75.0（digest 固定）の image 検査 | 両方とも **zlib CVE-2026-85091（medium、修正版 1.3.2-r1）の 1 件だけ**。CI の検査（2 イメージで各 1 件）と同じ |
| ワークフロー統制・方針ファイル | `scan.sh workflows`、`check-policy.mjs` | 6 ワークフロー + 1 composite、違反 0 件。方針ファイル PASS（問題 0 件） |
| ライセンス・npm audit | `scan.sh license`、`scan.sh npm-audit` | ライセンス 143 パッケージ、違反 0・期限内の例外 2。npm audit は 2 本とも 0 件（CI と同じ） |

**同じにならなかったもの（正直に）**: gitleaks は、この作業ツリー（git worktree）ではコンテナに履歴を渡せず「0 commit を走査」で **失敗**した（ガードが働いた）。別の clone（`refs/pull/*` も取得した）で走らせると、CI の走査範囲より広いため生の件数が増える（inspection-09）。ZAP・CodeQL は、この作業では再実行していない（CI の結果を採る）。

## inspection-05 Coverage・除外

**結論**: 走査範囲と除外は、各 `scan-run.json` の `coverage`・`exclusions` に機械的に残り、下表のとおり。**除外が意図どおりかは、筆者（AI）が設定を読んで確認した**。人（プロダクトオーナー）の確認は未実施で、PR のマージ（フェーズ1は AI の代行）は人の確認ではない（「人の確認済み」と書かない）。

| 検査 | 言語・path | URL・API | image | 除外 | 筆者の確認 |
|---|---|---|---|---|---|
| codeql | javascript-typescript。**302 ファイル・約 19,000 行**（scripts 155・backend 46・perf 25・e2e 23・frontend 15・`.github` 9・security 9 ほか）。アプリの `backend/src`・`frontend/src` とテスト・スクリプトを含む | — | — | 依存・生成物・テスト成果物・security-results | 意図どおり（生成物と依存だけを外す。テスト・スクリプトは外していない。実際に scripts と perf から検出が出ている） |
| gitleaks | **git 履歴全体（全 branch の全 commit）** | — | — | なし | 範囲は branch と tag。PR 参照（`refs/pull/*`）は含まない（修正前の PR 内コミットに generic-api-key が 1 件あることを 2026-10-12 の再実行で確認。CI の範囲外で、修正済み） |
| npm audit / osv-scanner / sbom / license | ルートの `package-lock.json`（backend・frontend・e2e の workspaces。直接・推移）。**`e2e/synthetic/` と `perf/screen/` の lockfile は含まない** | — | — | — | 2 つの別 lockfile は trivy fs（リポジトリ全体）が走査する。npm audit・osv・license・SBOM は未対象 |
| trivy fs | リポジトリ全体（lockfile・Dockerfile・workflow・設定） | — | — | node_modules・.cache・security-results・.git | 意図どおり |
| trivy image | — | — | `todo-app-backend:ci`・`todo-app-frontend:ci` | なし | **perf/screen イメージは対象外**（inspection-02 の 4） |
| hadolint | `backend/Dockerfile`・`frontend/Dockerfile`・`perf/screen/Dockerfile` | — | — | なし（`ignored: []`） | 3 つとも対象 |
| compose-check | `docker-compose.yml` | — | — | なし | — |
| zap | — | `http://localhost:8080`（frontend 経由）と、`backend/openapi.yaml` の **全 5 operation**（GET・POST `/api/v1/tasks`、PATCH・DELETE `/api/v1/tasks/{id}`、GET `/api/v1/health`） | — | なし | 全 operation を渡している |
| actionlint・W1〜W10 | `.github/workflows/*.yml`（6 本）と `.github/actions/*/action.yml`（1 本）、`security/*` | — | — | なし | — |
| ESLint | リポジトリ全体 265 ファイル（`maintainability` の `summary.json`。2026-10-12 に手元で実行して違反 0 件。以前の記載は 242 ファイル） | — | — | `**/node_modules/**`・dist・coverage・test-results・playwright-report・.cache・security-results・security-findings・reports | 意図どおり |

## inspection-06 SAST

**結論**: CodeQL（security-extended、103 クエリ、302 ファイル）の検出は **4 件で、重複排除後 2 件（いずれも medium、期限付き受容）**。high 以上は 0。「未解決なし」ではない（受容 2 件は期限 2027-01-09）。

**検査した観点**（クエリの網羅は SARIF の `tool.extensions` のルール一覧 103 件を数えて確認）:

| 観点 | 検査したクエリの例（件数） | 本アプリでの確認 |
|---|---|---|
| data flow（インジェクション） | `js/sql-injection`、`js/path-injection`、`js/command-line-injection` 系 5、`js/xss` 系 5、`js/request-forgery` 系、`js/prototype-pollution` 系 3、`js/unsafe-deserialization` | SQL は `sqlite-store.js` の `prepare` と `?`（4 文すべて）。`innerHTML`・`insertAdjacentHTML`・`eval`・`document.write` は frontend/src に無い（筆者が grep で確認、2026-10-12）。タイトルの HTML・SQL 断片は変換せず保存・返却する仕様で、TC-060 が確認 |
| validation | `js/polynomial-redos`・`js/redos`、`js/tainted-format-string` | 入力検証は `backend/src/domain/`・`http/` の層。TC-010〜012・TC-030〜036 が固定 |
| auth | `js/missing-token-validation`、cookie 系 3 | **認証が無い**（REQ-015）ので該当なし。TC-059 が「認証なしで全操作でき、Set-Cookie も無い」ことを確認 |
| crypto | `js/weak-cryptographic-algorithm`、`js/biased-cryptographic-random`、`js/insecure-randomness` | 暗号の自前実装は無い。乱数は `main.js` の `crypto.randomUUID`（ID 採番）だけ |
| error handling | `js/stack-trace-exposure`、`js/clear-text-logging`、`js/log-injection` | `errorHandler` は固定の文言とコードだけを返し、スタックを返さない（`backend/src/app.js`）。利用者データはログに出さない（`observability.test.js`） |

**検出**: `js/http-to-file-access`（ネットワーク由来の値をファイルに書く）の 4 箇所。`scripts/monitoring/run-monitors.mjs` の 3 行（68・70・71）と `perf/screen/measure.mjs` の 1 行（167）。指紋は **ファイル単位**で束ねるため 2 件になる。いずれも結果ファイル（`results.json`・`screen.json`）に測定対象の応答由来の値を保存するもので、書いた内容を実行・解釈する経路は無い。受容の根拠は inspection-17、追跡は Issue #33。

**台帳との対応（解消済み）**: GitHub の Code Scanning の同じ 4 件（アラート #14〜#17）は、以前は open のまま台帳とずれていたが、**2026-10-11T16:33〜16:34Z（2026-10-12 01:33 JST 前後）に dismissed（won't fix）にした**（コメントに AR-ID・期限・Issue #33。PR #57）。2026-10-12 の `gh api` で open 0 件・dismissed 4 件を確認した。台帳とのずれは `scripts/security/check-code-scanning.mjs`（`triage` ジョブ。読み取りのみ）が毎回検査する。

## inspection-07 DAST

**結論**: OWASP ZAP の baseline 走査と API 走査を、compose で起動した v1.0.0 のスタックに対して実行した。**認証なし**（`authenticated: false`）。本アプリに認証・セッションが無いので、認証なしの走査が全攻撃面。検出は 6 件（low 1・info 5）で、未解決は真陽性の info 1 件。

**走査した面**: frontend の公開ポート `http://localhost:8080`（静的ファイルと `/api` の中継）と、`openapi.yaml` の全 5 operation（API は backend のポートが公開されないので nginx 経由）。**session**: 無い（Set-Cookie なし。TC-059）。

| 検出 | 重大度 | 扱い |
|---|---|---|
| ZAP 100001（Unexpected Content-Type） | low | na。存在しないパスへの nginx 既定の HTML 404。入力を反映しない |
| ZAP 100000-1（4xx の記録） | info | na。不正入力・誤ったメソッドを仕様どおり 4xx で拒否した記録 |
| ZAP 10049-1（Non-Storable Content） | info | na。POST・PATCH・DELETE が保存されないという望ましい状態 |
| ZAP 10049-2（Storable but Non-Cacheable） | info | na。静的ファイルと 404。`expires -1` で毎回再検証 |
| ZAP 10049-3（Storable and Cacheable Content） | info | **tp**。GET `/api/v1/tasks`・`/api/v1/health` に Cache-Control が無い。是正は inspection-18 |
| ZAP 10109（Modern Web Application） | info | na。画面を判定しただけの情報 |

**しきい値**: `zap-rules.tsv` には IGNORE も FAIL も書いていない（全ルールが WARN 扱い）。初回の検査で出た CSP のディレクティブ不足（medium）とヘッダ不足（low 5）は `frontend/nginx.conf` の修正で解消済み（[security/README.md](../security/README.md)）。

**できていないこと**: 認証済みの面は存在しないので走査できない（inspection-02 の 1。承認は未取得）。ZAP は負荷・資源枯渇を狙わない（性能・過負荷は perf 層の k6 で見る。Issue #31）。ZAP の走査は 1 回（約 100 秒）で、API のファジングは ZAP の既定の範囲。

## inspection-08 SBOM／SCA／CVE／EOL

**結論**: 直接・推移依存の脆弱性は **npm audit 2 本・osv-scanner・trivy fs のすべてで 0 件**。見つかったのは **ベースイメージ（alpine）の zlib CVE-2026-85091（medium）だけ**で、到達不能、修正版 1.3.2-r1 は出ているが固定中のベースイメージにまだ入っていない。期限付き受容（AR-001、Issue #22、2027-01-09）。EOL 部品は検出されていない（方法と限界を下に書く）。

| 検査 | 対象 | 結果 |
|---|---|---|
| npm audit `--omit=dev` | 実行時依存（48 部品） | 0 件 |
| npm audit（全体） | 開発依存を含む 146 部品 | 0 件 |
| osv-scanner 2.6.0 | `package-lock.json`（直接・推移。OSV / deps.dev） | 0 件 |
| trivy fs | リポジトリ全体の lockfile（`e2e/synthetic`・`perf/screen` を含む） | 0 件 |
| trivy image | backend（Node.js 部品を含む）・frontend | 各 1 件（zlib のみ） |

**SBOM（CycloneDX）**: 実行時依存 48 部品（`sbom-runtime.cdx.json`、仕様 1.5）、全体 146 部品（`sbom.cdx.json`）、イメージ backend 80 部品・frontend 22 部品（trivy、仕様 1.7）の 4 本。ライセンスの記載は 146 部品中 143、イメージは 80 中 76・22 中 22。リリースでは、build-push-action が SBOM と provenance（mode=max）をイメージに付ける。

**直接・推移**: 直接依存は、ルート 6・backend 4・frontend 1・e2e 2・perf/screen 2・synthetic 1 の延べ 16 件で、重複（yaml、@playwright/test）を除くと npm 14 パッケージ。**出荷物（イメージ）に入る直接依存は fastify の 1 つだけ**で、frontend は依存ゼロの静的ファイル。推移依存は SBOM の依存グラフ（`npm sbom`）で追える。

**到達可能性・修正版**: zlib の `gz_vacate()`（gz* ファイル API）に影響し、nginx（deflate を直接使う）も Node（deflate ストリーム）も使わない → **到達不能**（台帳の記載。inspection-17）。修正版 `1.3.2-r1`、導入済み `1.3.2-r0`。

**EOL**: 機械判定は trivy の OS 判定（alpine 3.24.2。2026-10-12 の再検査で EOSL の印なし）と、Node は LTS の 24 系を採用（[ADR-0003](adr/0003-node-lts-24-pin.md)）。**npm 部品の EOL 日付のデータは持たない**ので、保守状況は人が調べた台帳（inspection-23）で補っている。

## inspection-09 Container／IaC／Secret

**結論**: コンテナ・構成は問題なし（low の na 1 件のみ）。秘密情報は **実際の秘密は 0 件**だが、gitleaks に **medium の誤検出 1 件（FND-012）**があった。v1.0.0 の run では台帳に未記載で untriaged（ゲートは pass）。台帳には PR #57 で fp を追記済みで、次の run から fp になる見込み。

| 区分 | 検査 | 結果 |
|---|---|---|
| base image | node:24-alpine（backend）、nginx-unprivileged stable-alpine-slim（frontend）。どちらも tag + digest 固定 | 脆弱性は zlib の medium 1 件ずつ。frontend は slim 版に変えて libtiff の high を解消済み |
| root | `backend/Dockerfile` は `USER 1000`、`frontend/Dockerfile` は `USER 101`、`perf/screen/Dockerfile` は `USER 1001`（数値指定。hadolint DL3066） | trivy DS-0002・hadolint とも 0 件 |
| 公開設定 | compose: backend のポートはホストへ公開しない。frontend は 8080 を全インターフェースで公開 | COMPOSE-006（low）= **na**（ローカル・社内の検証用。外部公開の本番は無い。公開先を絞るなら `127.0.0.1:8080:8080`）。本番に出すとき再検査 |
| 権限 | 両サービスに `cap_drop: [ALL]`・`no-new-privileges:true`。実行イメージから npm・corepack・yarn を除去 | COMPOSE-007 は解消済み。read-only ルートファイルシステムは未設定 |
| 暗号・通信 | TLS は無い（ローカル HTTP）。本番に出す設計は未着手 | 本番を出すときに設計（COMPOSE-006 の再検査条件） |
| 誤設定 | trivy fs の misconfig、hadolint（Dockerfile 3 本）、compose-check（8 ルール） | trivy fs 0、hadolint 0、compose 1（上の na） |
| 秘密情報 | gitleaks（履歴全体）、trivy fs の secret、GitHub secret scanning と push protection | 実際の秘密 0。GitHub のアラートは open 0・resolved 0。gitleaks の 1 件は下記 |

**gitleaks の 1 件（FND-012。medium、v1.0.0 の run では untriaged、誤検出と判断）**: 指紋 `53576ce6ece12daa`（`findings.json`）。検査証跡の SARIF（`docs/evidence/.../gitleaks.sarif`）の 1 行が、「製品名のキーワードと 40 桁の 16 進がある」ときに働く検索サービス向けトークンのルールに当たった。その 16 進は秘密ではなく、**検査対象の commit SHA**（`revisionId` の値）だった。再現の実験（2026-10-12、gitleaks 8.30.1、`dir` 走査）で確かめた。

| 実験の入力 | 結果 |
|---|---|
| ルールの説明文にある製品名の 1 行 + 40 桁の SHA の 1 行（同じファイル） | **検出 1 件**（そのルール） |
| 40 桁の SHA だけ | 検出なし |
| 製品名だけ | 検出なし |

したがって、検査証跡（SARIF・`findings.csv`・`evidence-index.csv`）が「この検出の説明文」と「commit SHA」を同じファイルに持つ限り、**取り込むたびに同じ種類の検出が増える**。実際、PR 参照まで含めた再実行では、`docs/data/findings.csv` と `evidence-index.csv` の複数行にも同じ検出が出た。対処は inspection-16・18 に書く。

## inspection-10 License／Provenance

**結論**: ライセンス違反は **0 件**（143 パッケージ）。成果物の**由来（SLSA provenance）と署名（cosign keyless）の両方があり、2026-10-12 に検証が通った**。

**license 義務・禁止条件**: [license-policy.yaml](../security/license-policy.yaml)。許可 11 種（MIT・MIT-0・ISC・Apache-2.0・BSD-2/3-Clause・0BSD・Python-2.0・CC0-1.0・BlueOak-1.0.0・Unlicense）、禁止パターン 9 個（GPL・AGPL・LGPL・SSPL・BUSL・EUPL・CC-BY-NC・CC-BY-SA・Commons-Clause。**例外でも原則認めない**）。許可リスト外は違反（deny by default）。

| 項目 | 内容 |
|---|---|
| 評価結果 | 143 パッケージ: MIT 105 / Apache-2.0 15 / ISC 8 / BSD-2-Clause 7 / BSD-3-Clause 5 / MPL-2.0 2 / BlueOak-1.0.0 1。違反 0 |
| 期限付き例外 | `@axe-core/playwright@4.13.0`・`axe-core@4.13.0`（MPL-2.0。E2E の開発依存で、未改変・再頒布なし。出荷物に含まれない）。期限 **2027-04-11** |
| 方針の二重化 | PR の dependency-review の許可リスト（`security.yml`）は方針の写しで、`check-policy` が一致を検査する |
| 検査ツール自身の依存 | 当初の SBOM・ライセンスツールは推移依存が方針違反になったため外し、`npm sbom` と依存ゼロの自作に置き換えた（約 260 パッケージ減。[security/README.md](../security/README.md)） |

**artifact の由来と署名の検証**（2026-10-12 JST。公開 digest は inspection-01 の値）:

```sh
gh attestation verify oci://ghcr.io/bsj-fujimoto/todo-app-backend@sha256:87addb2e3998f9c793e1c979f9b65d98d3cca98e1eea57be8c6ac28705f5a213 --repo bsj-fujimoto/todo-app
gh attestation verify oci://ghcr.io/bsj-fujimoto/todo-app-frontend@sha256:c82e88bae5e0aeb7d04df9e31808d1d490cdc6bc01b98efe11db7cd9b526ee9a --repo bsj-fujimoto/todo-app
cosign verify ghcr.io/bsj-fujimoto/todo-app-backend@sha256:87addb2e3998f9c793e1c979f9b65d98d3cca98e1eea57be8c6ac28705f5a213 --certificate-identity-regexp '^https://github.com/bsj-fujimoto/todo-app/.github/workflows/release.yml@' --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify ghcr.io/bsj-fujimoto/todo-app-frontend@sha256:c82e88bae5e0aeb7d04df9e31808d1d490cdc6bc01b98efe11db7cd9b526ee9a --certificate-identity-regexp '^https://github.com/bsj-fujimoto/todo-app/.github/workflows/release.yml@' --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

| 検証 | 結果 |
|---|---|
| `gh attestation verify`（2 イメージ。gh 2.102.0） | **終了コード 0**。述語 `https://slsa.dev/provenance/v1`、ビルドを署名した workflow は `release.yml@refs/tags/v1.0.0`、ソースの commit は `5fcf40a7e58d…`（対象と一致）、subject の digest は公開 digest と一致、run は 38152472087 |
| `cosign verify`（2 イメージ。cosign 3.1.3） | **成功**。claims の検証・透明性ログの存在（オフライン）・証明書の検証の 3 つが通り、署名の種類は `sigstore.dev/cosign/sign/v1` と `slsa.dev/provenance/v1`。証明書の identity は `release.yml` の workflow、issuer は GitHub Actions の OIDC |

**同一性（正直に）**: 検査した `:ci` イメージと公開したイメージは、**同じ commit・同じ Dockerfile・同じ固定ベースから別々にビルド**されており、イメージ ID が異なる（backend: 検査 `f0ab054b…` / 公開の再検査 `4b594f17…`、frontend: `e698b13c…` / `b46a9038…`）。2026-10-12 に公開 digest を同じ trivy で再検査し、検出が同じ（zlib の 1 件ずつ）ことは確かめたが、**ビットが同一であるとは言えない**。タグ v1.0.0 は Ruleset が未適用なので、削除・移動を機械は止めない（provenance と署名は digest に結び付くので、タグの付け替えでは検証は壊れない）。

## inspection-11 Architecture準拠

**結論**: backend は 12 ファイル・層をまたぐ依存 13 本、frontend は 7 ファイル・同 7 本。**層の逆流・越境 0 件、循環 0 件**（2026-10-12、`node scripts/security/check-arch.mjs` を手元で実行して確認）。この検査は **PR #57 から CI に入り**（`security.yml` の `maintainability` ジョブ。違反・許可外の依存・未分類のファイル・循環があれば失敗）、層の定義は [security/architecture.yaml](../security/architecture.yaml) に明示された（以前は CI に無く、コードのコメントと本書だけだった）。**v1.0.0 の run の記録には無い**（次の run から `arch.json` が残る）。

**層（上が下を使う。下は上を知らない）**:

| 側 | 層 | ファイル | 使ってよい先 |
|---|---|---|---|
| backend | main（composition root） | `main.js` | app・config・store、node:crypto・fs・path。**時刻・UUID・環境変数・実ファイルに触れるのはここだけ** |
| backend | app | `app.js` | routes・errors・fastify。store・時刻・採番は引数で受け取る（`buildApp`） |
| backend | routes | `routes/tasks.js`・`health.js` | domain・http・errors。**store は注入**（routes は store を import しない） |
| backend | http | `http/request.js` | domain・errors |
| backend | store | `store/sqlite-store.js`・`migrations.js`・`sqlite-errors.js` | domain・errors・node:sqlite |
| backend | domain | `domain/task.js`・`title.js` | domain 内・errors のみ（I/O・環境変数を使わず、現在時刻を読まない。日時文字列の検証に `Date.parse` を使うだけ） |
| backend | errors・config | `errors.js`・`config.js` | 下位（errors は何も import しない。config は環境変数を直接読まず引数で受ける） |
| frontend | main | `main.js` | app・view・api-client（`fetch` の実体をここで注入） |
| frontend | app | `app.js` | state・validation（api と view は注入） |
| frontend | view | `view.js` | messages・state（DOM に触れるのはここだけ） |
| frontend | api-client | `api-client.js` | なし（`fetch` は引数） |
| frontend | core（純粋） | `state.js`・`validation.js`・`messages.js` | core 内のみ |

**確認した方法**: `check-arch.mjs` が、import 文（静的・re-export・動的）から依存グラフを作り、`architecture.yaml` の宣言（`may_depend_on`・`allow_external`）に当てはめて逆流・許可外の外部依存・未分類のファイルを数え、循環を探す（結果は `arch.json`）。本書の表は筆者が最初に import を読んで書いたもので、`architecture.yaml` の層とは区切り方が少し違う（`errors.js` を `kernel` として独立させ、domain → kernel だけを許した。routes と http は同じ `web` 層、main と config は同じ `entry` 層にまとめた。domain が他の層に依存しない規則は守られている）。外部の import は fastify（`app.js`）・node:crypto／fs／path（`main.js`）・node:sqlite（`sqlite-store.js`）だけで、純粋な層（domain・state・validation・messages・errors）には外部 import も `document`・`fetch`・`process` もない。

**境界・可用性・観測性・例外**（コードを読んで確認）:

| 観点 | 実装 | 確認 |
|---|---|---|
| 境界 | 時刻（`clock`）・ID 採番・store・ログ出力先は `buildApp` の引数。frontend は `fetch`・DOM を注入 | `eslint.config.js` の規約が強制（inspection-21）。unit・api テストが注入で動く |
| 可用性 | `/api/v1/health` は DB に接続できないとき 503 と `degraded`。HEALTHCHECK・compose の healthcheck・`restart: unless-stopped`。SIGTERM・SIGINT で `app.close()` のあと store を閉じる | TC-076・compose テスト、外形監視（MON-002） |
| 観測性 | `x-request-id`（安全な形式だけ採用）を応答とログに付ける。pino の JSON ログ（reqId・statusCode・応答時間）。利用者データはログに出さない | `backend/test/api/observability.test.js` |
| 例外 | `AppError` とコード表（`errors.js`）。サーバー側のコードだけ error ログ、利用者の入力ミスは出さない。未知の例外は `INTERNAL_ERROR` に写す。巨大な本文は上限付きで読み捨てて応答 | contract テストがコードと契約の `Error.code` を突き合わせる |

**できていないこと**: ① ~~層の依存方向の検査が CI に無い~~（PR #57 で解消。v1.0.0 の run の記録には無い）。② 層の定義は `architecture.yaml` にあるが、ADR になっていない（判断の経緯の記録が無い）。③ `app.js`（130 行）に request-id・本文超過の読み捨て・エラー写像・フックが同居し、しきい値内だが責務が混ざる（inspection-20 の所見）。

## inspection-12 SEO／AIO

**結論**: **対象外**。公開コンテンツサイトではなく、ログイン不要の 1 画面の個人用タスク管理アプリで、検索流入・AI による引用を目的としない。機械の検査（index・meta・structured data・crawl）は実施していない。

| 項目 | 内容 |
|---|---|
| 理由 | 公開コンテンツ（説明ページ・LP）が無い。外部公開の本番 URL も無い（compose の `http://localhost:8080`）。`robots`・sitemap・構造化データは意図して持たない |
| 承認者（ロール） | プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ） |
| 承認日 | 2026-10-12（plan-03 を含む PR #41 と `ai-context.yaml` の PR #40 のマージ日。AI の代行マージで、オーナーの確認は未実施）。出典: [docs/01-test-plan.md](01-test-plan.md) の plan-03、`docs/ai-context.yaml` の EXC-003 |
| 期限（見直し日） | 2027-04-12 |
| 前提が崩れたとき | 公開 Web ページを足す・外部へ公開するときに、メタ情報・構造化データ・robots・根拠性（引用元・著者）の観点を適用に戻す |

## inspection-13 GitHub Ruleset／Branch protection

**結論**: **Ruleset とブランチ保護は適用されていない**（2026-10-12 01:03 JST、Ruleset 0 件・ブランチ保護 404）。定義（`.github/settings/ruleset-main.json`）は用意してあるが、**いま main の保護は定義どおりには効いていない**。効いているのはマージ方式（squash のみ）・マージ後のブランチ削除・secret scanning と push protection・Dependabot security updates。マージ挙動での有効性確認は、適用しないと行えない。

**取得日時と方法**: 2026-10-12 01:03 JST、`gh api repos/bsj-fujimoto/todo-app/rulesets`（読み取り）→ `[]`。`gh api repos/bsj-fujimoto/todo-app/branches/main/protection` → 404 `Branch not protected`。続けて `node scripts/ci/apply-settings.mjs --dry-run`（01:15 JST。何も変更しない）と `scripts/ci/snapshot-github.sh`（読み取りのみ）。**404 は「機能が無効・未設定」であって、「問題なし」ではない**。

**期待する統制（定義）と実態の差**:

| 統制 | 期待（`ruleset-main.json`・[ADR-0004](adr/0004-single-maintainer-governance.md)） | 実態（2026-10-12 01:03 JST） | 差 |
|---|---|---|---|
| main を対象とする有効な Ruleset | `main-protection`、enforcement active | **0 件** | 未適用 |
| PR 必須（直接 push 不可）、squash のみ | 必須。`allowed_merge_methods: [squash]` | PR 必須は**効かない**。squash のみは**効いている**（リポジトリ設定: squash 可・merge commit 不可・rebase 不可） | PR 必須が欠ける |
| 承認 | 1 件 + code owner review（`.github/CODEOWNERS`） | 効かない。マージ済み 24 件のうち承認（APPROVED）は **0 件**、レビューが付いたのは 4 件 | 欠ける。**運用では「承認 = オーナーによるマージ」** |
| required status checks | `ci-result`・`security-result`（`strict`）。`integration_id: 15368` | 効かない。ただし 2 つの check は main の直近 run で成功している（適用の前提は満たす） | 欠ける |
| force push 禁止 | `non_fast_forward` | 効かない | 欠ける |
| ブランチ削除禁止・linear history | `deletion`・`required_linear_history` | 効かない（squash のみなので履歴は線形） | 欠ける |
| bypass | Admin ロールの `pull_request` モードのみ（直接 push・force は不可） | Ruleset が無いので該当なし | 定義上は 1 件で最小 |
| リリースタグ保護 | `release-tags`（`v*` の削除・更新・force を禁止） | **0 件**（タグ v1.0.0 は保護されていない） | 未適用 |
| CODEOWNERS | `*`・`/docs/`・`/backend/openapi.yaml`・`/.github/` | ファイルあり（`.github/` を含む） | 適用の効果は Ruleset 次第 |

**dry-run の差分（2026-10-12 01:15 JST）**: 5 項目に差分。Ruleset `main-protection`・`release-tags` が「新規作成」、`secret_scanning_non_provider_patterns` と `secret_scanning_validity_checks` が disabled（定義は enabled）、ラベル `incident` の説明の差。それ以外（squash のみ・ブランチ削除・push protection・Dependabot alerts と security updates・private vulnerability reporting・Actions の許可範囲・SHA 固定の強制・workflow の既定権限・フォーク PR の承認）は**定義と一致**。

**マージ挙動（実績）**: main の 25 commit は、初期 import の 1 件と PR 経由の 24 件。直接 push は初期以外に無い。**ただしこれは運用で守られているだけで、機械が止めているのではない**。マージ済み PR の 24 件が CI を通ってから入ったかは、本書では集計していない。

**適用の予定と確認の計画**: 適用はリポジトリ管理者の作業で、手順は `scripts/ci/apply-settings.sh --dry-run` → `scripts/ci/apply-settings.sh`（`--only-rulesets` で Ruleset だけ別に適用できる）→ `scripts/ci/snapshot-github.sh` で実態を保存。適用後は、(1) 赤い check を持つ PR がマージできないこと、(2) `main` への直接 push が拒否されること、(3) bypass を使ったマージが監査ログに残ることを実際に試して確認する。**適用前は、統制があるとは書かない**。

## inspection-14 GitHub Actions統制

**結論**: Actions の統制は**実効している**。ワークフロー 6 本・composite 1 本・ジョブ 34 件・外部 action の参照 98 件が、W1〜W10 の自動検査で**違反 0 件**（CI の governance ジョブ。2026-10-12 に手元でも `check-workflows.mjs` を実行して 0 件）。GitHub 側の設定も、SHA 固定の強制・既定 read・フォーク PR の承認で定義と一致。逸脱は PR ごとに自動で検出して失敗にする。

| 項目 | 検査・設定 | 実態 |
|---|---|---|
| permissions | W1: 直下は read のみ、write-all 不可。W10: ジョブの write は許可リスト（[workflow-policy.yaml](../security/workflow-policy.yaml)）だけ | 6 本すべて直下 `contents: read`。write を持つジョブは 8 件（security-events・issues・contents・packages・attestations）で、理由が許可リストに書いてある |
| SHA pin | W2 + GitHub 側 `sha_pinning_required: true` | ステップの `uses` 124 件 = 外部 98 件（すべて 40 桁 SHA 固定）+ ローカル 26 件。未固定 0 |
| secret | W7: フォーク PR に secret を出さない。W9: 信頼できない値を `run` に直接埋め込まない | 使う secret は `GITHUB_TOKEN` だけ（`release.yml` の GHCR ログイン）。checkout 31 件すべて `persist-credentials: false` |
| OIDC | W8: `id-token: write` は許可リストのジョブだけ | `release.yml#publish` の 1 ジョブだけ（cosign keyless 署名・provenance） |
| environment | 検査項目なし | **使っていない**（`environment:` が 0 件）。デプロイが無く、publish に承認ゲートは無い（タグの push で ci・security・evidence-check が全成功なら公開） |
| timeout | W4 | 全ジョブ（reusable を呼ぶものを除く）に設定 |
| concurrency | W5 | 6 本すべてに設定 |
| 危険な構成 | W3: `pull_request_target` 不使用。W6: `continue-on-error` なし | 0 件 |
| GitHub 側 | 許可する action は GitHub 製 + 明示した 6 パターン。既定権限 read。Actions による PR 承認は不可。フォーク PR は外部のコントリビュータ全員の承認が必要 | 定義と一致（2026-10-12 の `gh api`） |
| 構文 | actionlint 1.7.12 | 0 件 |

**逸脱の自動検出**: governance ジョブは PR・push・週次・release で毎回動き、1 件でも逸脱があれば `security-result` が失敗する。許可リストの追加は CODEOWNERS によりレビュー対象。

**できていないこと**: ① GitHub 側の設定のずれ（今回の dry-run が示した 5 項目）を **自動で検出する仕組みは無い**（`apply-settings.mjs --dry-run` を人が実行する）。② `release.yml#publish` に環境の承認ゲートが無い。③ **`security.yml` の `file-security-issues` が push で一度も動いていなかった**（main への push の 16 run すべてで skipped）。原因は条件式 `inputs.create_issues != false` で、push・schedule では `inputs` が空文字で、`'' != false` は両辺が数値 0 になり偽だった。**PR #57 で `format('{0}', inputs.create_issues) != 'false'` に直し、`workflow_dispatch` の run 38158649674 で skipped にならず実行されたこと（success）を確認した**。同じ指紋の Issue には追記し、closed の再発は reopen し、重複は作らない。

## inspection-15 Dependabot／Dependency review／npm audit

**結論**: Dependabot の version updates と security updates は有効（2026-10-11 に有効化）で、alerts は取得でき、**open も過去分も 0 件**。**version updates の設定は、PR #57 でマニフェスト 13 件すべてを覆う形になった**（以前は 13 件中 8 件）。**週次の定期 audit はまだ 1 回も成功していない**（初回は 2026-10-12 19:00 UTC）。

**設定**（[dependabot.yml](../.github/dependabot.yml)）: npm（`/`・`/backend`・`/frontend`・`/e2e`）、github-actions（`/`・`/.github/actions/setup-node-npm`、SHA 固定のまま追従）、docker（`/backend`・`/frontend`）、docker-compose（`/`）。週次（月曜 03:00 JST）、公開直後の版は 3 日待つ（cooldown）、グループ化、更新 PR 上限 5、ラベル・reviewer 付き。Node は major を提案しない（`ignore` の `update-types: version-update:semver-major`。PR #60 で、versions 指定が効かなかったため直した。ADR-0003）。

**coverage（マニフェスト 13 件との照合。PR #57 の後は 13/13。「備考」の列に以前の状態を残す）**:

| マニフェスト | version updates | 備考 |
|---|---|---|
| `package.json`・`package-lock.json`（ルート）、`backend/package.json`・`frontend/package.json`・`e2e/package.json` | 覆う（npm の 4 ディレクトリ） | workspaces |
| `backend/Dockerfile`・`frontend/Dockerfile` | 覆う（docker） | |
| `docker-compose.yml` | 覆う（docker-compose） | |
| `e2e/synthetic/package.json`・`package-lock.json` | 覆う（npm の `/e2e/synthetic`。PR #57 で追加） | 外形監視のブラウザジャーニー用。`@playwright/test`。以前は覆っていなかった |
| `perf/screen/package.json`・`package-lock.json` | 覆う（npm の `/perf/screen`。PR #57 で追加） | `lighthouse`・`playwright-core`。以前は覆っていなかった |
| `perf/screen/Dockerfile` | 覆う（docker の `/perf/screen`。PR #57 で追加） | Playwright 公式イメージ（版は `playwright-core` と同じにそろえ、`check-policy` が検査）。以前は覆っていなかった |
| `.github/workflows/*`・composite action | 覆う（github-actions） | |

以前に覆っていなかった 5 件も、脆弱性の alerts（依存グラフ）は全マニフェストが対象で、trivy fs もリポジトリ全体を走査していた。PR #57 では `/perf`（`perf/compose.perf.yml` の docker-compose）も追加し、`check-policy` が**追跡ファイルから全マニフェストを列挙して `dependabot.yml` と照合し、漏れ・古い記載があれば CI が失敗**する（`scripts/security/lib/manifests.mjs`・`manifest-policy.mjs`）。

| 項目 | 実態（2026-10-12 01:03 JST） |
|---|---|
| alerts | 取得できる（`dependabot/alerts` が 200）。**全状態で 0 件** |
| security updates | enabled（`gh api repos/bsj-fujimoto/todo-app` の `security_and_analysis`）。vulnerability-alerts は有効（204） |
| 実績 | 2026-10-11 08:58 UTC に Dependabot の更新 job 4 本（npm・github-actions・docker・docker-compose）が成功。PR は 2 件（#27・#58。どちらも node 24 → 25 の docker）で、LTS でないためクローズした（#27 の後に足した `ignore`〔versions 指定〕が効かず #58 が出たため、PR #60〔2026-10-12〕で `update-types`〔major〕に変えた。ADR-0003） |
| dependency review | PR のみ（high 以上と方針外ライセンスで失敗）。PR の run で success を確認。push では skipped が正 |
| npm audit | `security.yml` の sca ジョブで 2 本（`--omit=dev`・全体）、結果は JSON を artifact に 90 日保存、`scan-run.json` にコマンド・commit・日時 |
| 定期 audit | `security.yml` の `schedule: 0 19 * * 1`。**`last_success_at` は null**（schedule の成功実績がまだ無い）。週次の run が台帳と実際のずれ（`stale_ledger_entries`）も出す |
| 放置された重大 alert | なし（alert 0 件） |

**できていないこと**: ① ~~5 マニフェストの version updates~~（PR #57 で解消。追加分の Dependabot の PR 実績はまだ無い）。② 定期 audit の成功実績（初回の 2026-10-12 19:00 UTC の後に確認する。運用が 4 日未満で継続性は評価できない）。③ Dependabot が出した PR は 2 件（#27・#58。どちらも不採用）だけで、「週次で PR が作られている」実績は評価できない。

## inspection-16 Triage・重複排除

**結論**: 検出は **15 件（生）→ 12 件（重複排除後）**（v1.0.0 の run。main の `findings.csv` もこの 12 件）。分類は accepted 4 / na 6 / tp 1 / **untriaged 1**（未トリアージ率 1/12 = 8%）。fp・dup・fixed は今回 0 件。前回 run（38152163102）との比較は新規 0・継続 12・解消 0。**未判断の 1 件（FND-012）は誤検出と判断でき（inspection-09）、台帳（`triage.yaml`）には PR #57 で fp を追記済み**だが、v1.0.0 の run の結果としては untriaged のまま（run の時点の事実を書き換えない）。次の run で fp になる。

**重複排除の内訳**: CodeQL の同じ規則・同じファイルの 4 件 → 2 件（行番号を指紋に入れない）、ZAP の baseline と API 走査が同じアラートを出した 1 件 → 1 件にまとめ、15 → 12。

**機械が決めること**: 指紋（ツール + ルール + 場所（行番号なし）+ 部品）による重複排除、別ツールの同じ勧告 ID × 同じ部品の dup 判定、前回との差分（新規・継続・解消）、受容の期限切れ、ゲート。**人が決めること**（`security/triage.yaml`・`accepted-risks.yaml` に書く。**機械は作り話を足さない**）: 真陽性か、到達可能性・公開範囲・資産影響・補完統制、是正。書かれていない検出は untriaged のまま残り、critical・high ならゲートで止まる。

**12 件の分類**（行の正本は `findings.json` と `docs/data/findings.csv`。main の CSV は PR #42 の取り込みで 12 件〔FND-001〜012〕になり、本表と一致する。以前の main は 9 件だった）:

| ID | 検出 | 重大度 | ステータス |
|---|---|---|---|
| FND-001 | compose-check COMPOSE-006（公開ポートを全インターフェースに bind） | low | na |
| FND-002 | trivy CVE-2026-85091（backend の zlib） | medium | accepted（AR-001、#22） |
| FND-003 | 同上（frontend の zlib） | medium | accepted（AR-001、#22） |
| FND-004 | ZAP 100001 | low | na |
| FND-005 | ZAP 100000-1 | info | na |
| FND-006 | ZAP 10049-1 | info | na |
| FND-007 | ZAP 10049-3 | info | **tp**（owner: バックエンド担当、期限 2026-12-31。ACT-005） |
| FND-008 | ZAP 10109 | info | na |
| FND-009 | ZAP 10049-2 | info | na |
| FND-011（指紋 `0072806ba1207386`） | CodeQL `js/http-to-file-access`（`scripts/monitoring/run-monitors.mjs`） | medium | accepted（AR-002、#33） |
| FND-010（指紋 `f5040de9defbe848`） | CodeQL 同上（`perf/screen/measure.mjs`） | medium | accepted（AR-003、#33） |
| FND-012（指紋 `53576ce6ece12daa`） | gitleaks（検査証跡の誤検出） | medium | **untriaged**（v1.0.0 の run。台帳は PR #57 で fp。`findings.csv` の owner・due は ACT-010 と同じ セキュリティ担当・2026-10-19） |

安定 ID（`FND-nnn`）は fingerprint から決まり、`security/finding-ids.yaml` の台帳に登録する。**v1.0.0 の 3 件（FND-010〜012）は PR #42 で登録済み**（以前は未登録で CI が仮 ID を振って警告していたため、指紋で示していた）。

**最終判断は人**: tp と fp の最終判断はセキュリティ担当（ロール）が台帳に書く。FND-003 は FND-002 と同じ勧告・同じ部品名なので機械は dup 判定を付けるが、別イメージの別インスタンスで、受容の台帳が優先されて accepted になる（件数に残している）。重複排除の鍵に「場所（イメージ）」が入っていない点は、検査ツール側の課題として依頼表に書く。

**未判断 1 件への対応（実施済み。確認待ち）**: `security/gitleaks.toml` に理由付きの allowlist（当該ルール `sourcegraph-access-token` だけを `docs/evidence`・`docs/data` から除く）を足し（PR #42）、`security/triage.yaml` に当該ルールを fp として書いた（PR #57。理由: 検査証跡の commit SHA と検出ルール名の同居。再検査条件: gitleaks のルール更新時・証跡の形式の変更時。owner セキュリティ担当・期限 2026-10-19）。**マージ後の最初の `security.yml` の run で、このルールの検出が無いことを確かめる**（ACT-010。`actions.csv` では in_progress）。確かめるまでは「解消した」と書かない。

## inspection-17 文脈付きリスク評価

**結論**: high 以上の検出は 0 件で、medium 以下の 12 件について、v1.0.0 の run の時点で台帳に**到達可能性・公開範囲・資産影響・補完統制**が書かれているのは 11 件（未判断の 1 件〔FND-012〕だけが空）。FND-012 は PR #57 で台帳に追記した（次の run から 12 件）。点数（CVSS・ツールの level）だけで決めず、「実際に届くか」で優先度を決めている。出典は `findings.json` と [triage.yaml](../security/triage.yaml)・[accepted-risks.yaml](../security/accepted-risks.yaml)。

| 検出 | ツールの値 | 到達可能性 | 公開範囲 | 資産影響 | 補完統制 | 優先度の判断（本書） |
|---|---|---|---|---|---|---|
| zlib CVE-2026-85091（FND-002・003） | medium | **なし**（gz* ファイル API を使うコードパスが無い。nginx も Node も使わない） | backend は compose の内部ネットワークのみ。frontend は 8080 を公開（静的ファイルと /api の中継） | 低（到達できないので影響する資産が無い） | 非 root・cap_drop ALL・no-new-privileges・圧縮ファイルを受け取らない・npm を実行イメージから除去 | **低**。ベースイメージの更新で消す（期限 2027-01-09） |
| CodeQL 結果ファイル書込み（AR-002・003） | medium（level warning） | なし（書いたファイルを実行・解釈しない。読むのは `JSON.parse` のみ） | CI の作業ディレクトリと artifact（90 日）。外部に公開しない。計測コンテナは非 root・内部ネットワーク | 低（計測値・測定対象の応答の文字列が結果に入るだけ） | Markdown 要約の `\|` と `\\` をエスケープ、失敗詳細の引用は 80 文字で切り詰め、検証は契約（スキーマ）で行う | **低**。長さ上限・制御文字除去の共通化で解消（期限 2027-01-09） |
| ZAP 10049-3（FND-007） | info | **到達可能**（認証の無い公開 API。誰でも GET できる） | frontend 経由。社外公開の想定は無い | 低（タスク一覧は機密でない。影響は古いデータの表示） | 静的ファイルは `expires -1`。API はブラウザの既定ではヒューリスティックキャッシュに入りにくい | **低**（真陽性だが info）。期限 2026-12-31 |
| COMPOSE-006（FND-001） | low | 到達可能（意図した公開） | 検証用の端末・社内ネットワーク | 低（個人用。認証・機密なし） | 非 root・cap_drop ALL・セキュリティヘッダ・入力検証。backend のポートは非公開 | **na**。本番に出すとき再検査 |
| ZAP の na 5 件（FND-004〜006・008・009） | low 1・info 4 | 該当しない（脆弱性ではない記録・情報） | frontend の公開ポートまたは該当なし | なし | 404 は入力を反映しない・`server_tokens off`・`expires -1` | **対応なし** |
| gitleaks（FND-012。指紋 `53576ce6ece12daa`） | medium | v1.0.0 の run の時点では**台帳に記載なし**（筆者の分析: 秘密ではなく commit SHA。到達可能性は無し） | — | — | — | PR #57 で fp と allowlist を台帳に書いた。**確認は次の run**（ACT-010） |

**ゲートとの関係**: critical・high の未解決が 1 件でもあればゲートが失敗し、medium は失敗にせず Issue 化または期限付き受容、low・info は記録のみ（SLA は inspection-18）。**文脈は優先度と期限を決める材料であり、重大度の数値そのものは書き換えない**（accepted にしても severity は medium のまま残る）。

## inspection-18 是正提案・フィードバック

**結論**: 未解決 6 件（v1.0.0 の run の時点）のうち、修正方法・owner・期限・再検査条件が揃っているのは 5 件。**未判断の 1 件（gitleaks の誤検出。FND-012）は、v1.0.0 の run の時点では台帳に何も書かれていなかった**が、その後 PR #57 で台帳に追記した（owner セキュリティ担当・期限 2026-10-19。ACT-010）。owner と期限は人が決めるもので、本書の値は台帳の記載と、筆者の提案（提案と明記）を分けて書く。

**重大度ポリシーと SLA**（[security/README.md](../security/README.md)。`SECURITY.md` の一次回答 7 日・high 以上の是正方針 30 日以内と併せて運用）:

| 重大度 | 扱い | 是正の期限 |
|---|---|---|
| critical | 未解決は失敗。受容できない | 7 日 |
| high | 未解決は失敗。やむを得ず受容するなら 30 日以内の期限付き | 30 日 |
| medium | 失敗にしない。Issue（ラベル `security`）を起票し、修正または期限付き受容 | 90 日 |
| low・info | 記録のみ | 次の依存更新・リファクタのとき |

| 対象 | 修正方法 | 代替案 | owner（ロール） | 期限 | 再検査条件 | 追跡 | 状態 |
|---|---|---|---|---|---|---|---|
| zlib（FND-002・003） | ベースイメージの digest を更新して zlib 1.3.2-r1 以上にし、AR-001 を台帳から外す | 台帳に記載なし。筆者案: Dockerfile で zlib だけ `apk upgrade` する方法はあるが、ビルドの再現性が下がるため採らない（担当の判断待ち） | セキュリティ担当 | 2027-01-09（受容の期限。再確認 2027-01-02） | Dependabot（docker）がベースを更新したとき・trivy image で 1.3.2-r1 以上になったとき・期限の 7 日前 | #22・ACT-001・AR-001 | 受容中（accepted） |
| CodeQL 結果ファイル書込み（AR-002・003） | 結果ファイルへ書く文字列の長さ上限・制御文字の除去を共通化する | 受容を更新する。Code Scanning のアラート #14〜#17 は理由付きで dismiss 済み（PR #57。2026-10-11T16:33〜16:34Z） | SRE 担当 | 2027-01-09 | 共通化を入れたとき・期限の 7 日前 | #33・AR-002・AR-003 | 受容中。**新規ケース案**（長い文字列・制御文字を与える unit）は Issue #33 に記載 |
| ZAP 10049-3（FND-007） | backend の応答に `Cache-Control: no-store` を付ける（`backend/src/http` か `app.js` の onSend フック。OpenAPI の契約は変わらない） | frontend の nginx で `/api/` に `proxy_hide_header` と `add_header` を足す（ただしセキュリティヘッダの継承が切れるので全ヘッダを書き直す） | バックエンド担当 | 2026-12-31 | backend に付けたあと ZAP 走査で 10049 が消えること | ACT-005 | open（未着手） |
| gitleaks の誤検出（FND-012。`53576ce6ece12daa`） | `triage.yaml` に fp を記載、`gitleaks.toml` に allowlist を追加（inspection-16。**どちらも実施済み**） | 証跡ファイルから SHA を除く（取り込みの仕組みを変えるので大きい。採らない） | セキュリティ担当 | 2026-10-19（ACT-010 の期限。台帳 `triage.yaml` にも記載） | gitleaks のルール更新時・証跡の形式を変えたとき | ACT-010（Issue は未起票） | 対応中（in_progress。次の run で確認） |

**再検査の条件と追跡**: 修正の PR は、その PR の security.yml の再実行で検出が消える（fixed）ことをもって完了とする。fp・na・accepted の再検査条件は台帳の `reverify_condition`。週次の run が台帳のずれを出す。**解消を再検査で確認した実績**: 初回の run（PR #19、2026-10-11）の 46 件（high 10・medium 17・low 12・info 7）は、修正（実行イメージから npm を除去して勧告 21 件、libtiff、USER の明示、CodeQL の file-system-race 2 件、ZAP のヘッダ 6 件、compose 2 件、hadolint 3 件）と、受容・na の分類で、処理後の run で 9 件（medium 2・low 2・info 5）になり、ゲートが pass した（[security/README.md](../security/README.md) の処理表）。今回の run では `fixed` は 0 件（前回との差が無いため）。

**他の是正・依頼**（検査の不備。末尾の表にもまとめた）: `file-security-issues` の条件式・Dependabot の 5 マニフェスト・依存選定台帳の欠落・公開 digest の検査・アーキテクチャ検査の CI 化・ESLint の検査記録化は **PR #57 で完了**。残るのは Ruleset の適用ほか（末尾の表の状態の列）。

## inspection-19 コード品質の指摘

**結論**: 保守性は ESLint（CI の `lint` ジョブ）で検査し、**error・warning とも 0 件**（265 ファイル、2026-10-12 に `npm run lint` と `eslint-maintainability.mjs` で確認。以前の記載は 242 ファイル）。ただし**重複コードの検出と性能の静的検査は入れていない**。ESLint の結果は、PR #57 から **`maintainability` ジョブが SARIF・`thresholds.json`・`summary.json`・`scan-run.json`（`check_kind: maintainability`、`rule_classes`）として保存する**（違反が 1 件でもあれば失敗。以前は CI のログのみだった）。v1.0.0 の run の記録には無く、次の run から残る。

| 観点 | 検査 | 結果 |
|---|---|---|
| 複雑度・関数の長さ・引数・ネスト・ファイルの大きさ | ESLint の `complexity`・`max-lines-per-function`・`max-params`・`max-depth`・`max-lines` | 0 件（inspection-20） |
| 規約違反 | `js.configs.recommended`、`eqeqeq`・`no-var`・`prefer-const`・`no-console` | 0 件 |
| 純粋さ・副作用 | `no-restricted-properties`・`no-restricted-syntax` | 0 件（inspection-21） |
| 重複 | **なし**（jscpd など未導入） | 検査していない |
| 性能（静的） | **なし**。性能は perf 層（k6）の動的試験 | Issue #31（backend の 1 要求のコストが件数に比例する設計。minor、open）は動的試験で発見 |

**受容した指摘**: 0 件（期限付きで受容したものは無い）。`eslint-disable` は 2 箇所（Playwright の fixture の `no-empty-pattern`。`e2e/compose/stack.spec.js`・`e2e/fixtures/observe.js`）で、複雑度・責務の規約ではない。

**できていないこと**: ~~ESLint の出力を機械可読で残していない~~（PR #57 で解消。`ai-context.yaml` も `maintainability` を `expected_checks` に含めた）。残るのは、v1.0.0 の run の記録に無いこと（次の run から）と、重複コード・性能の静的検査を入れていないこと。

## inspection-20 単一責任

**結論**: **閾値を決めて CI で止めており、超過は 0 件・受容も 0 件**。`ci.yml` の `lint` ジョブ（`npm run lint`）が必須の集約ジョブ `ci-result` の `needs` に入っている。**ただし Ruleset が未適用のため、GitHub が赤いままのマージを止めるわけではない**（inspection-13）。PR #57 から、閾値（`complexity`・`max-lines-per-function`・`max-params`・`max-depth`・`max-lines`）と違反の件数は、`security.yml` の `maintainability` ジョブが `thresholds.json`・`summary.json`・SARIF・`scan-run.json`（`rule_classes`: complexity・size・params・purity）として記録する（違反が 1 件でもあれば失敗）。v1.0.0 の run の記録には無く、次の run から残る。

| ルール | 上限 | 設定 | 実測の最大（backend/src・frontend/src の 19 ファイル。2026-10-12） |
|---|---|---|---|
| 循環的複雑度 `complexity` | **8** | error | 7（`frontend/src/api-client.js:17`） |
| 関数の長さ `max-lines-per-function` | **40 行**（空行・コメント除く） | error | 31 行（`backend/src/app.js:96`） |
| 引数の数 `max-params` | **4** | error | 4（`frontend/src/view.js:41`。上限ちょうど） |
| ネスト `max-depth` | **3** | error | 2（`backend/src/store/migrations.js:53`） |
| ファイルの大きさ `max-lines` | **250 行** | error | 127 行（`frontend/src/view.js`） |

**緩めている範囲（正直に）**: テストファイル（44 件）は関数・ファイルの行数のみ off（複雑度・引数は本番と同じ）。純粋さの規則は composition root とスクリプトの入口で off（inspection-21）。`lib/` 配下（89 件）には本番と同じ規約がかかる。

**責務の読み取り**（機械でない所見）: 閾値内でも、`backend/src/app.js`（130 行）には request-id の解決、巨大な本文の読み捨て、エラーの写像、フック登録が同居する。閾値には当たらないが、`http/` の層へ切り出す候補。それ以外の `domain/`・`store/`・`routes/`・frontend の各ファイルは、読んだ範囲で責務が 1 つ。

## inspection-21 純粋さと副作用の閉じ込め

**結論**: 時刻・乱数・ID 採番を直接呼ぶ規則を CI で止めており、**対象コードの違反は 0 件**。実際、`backend/src`・`frontend/src`・`scripts/*/lib` で `Date.now`・`Math.random`・`randomUUID()`・引数なしの `new Date()` は、composition root の `backend/src/main.js:19`（`new Date().toISOString()` を `clock` として注入）の 1 箇所だけ（2026-10-12、grep で確認）。規約は [eslint.config.js](../eslint.config.js) の冒頭と [CONTRIBUTING.md](../CONTRIBUTING.md) に明文化されている。PR #57 から、この規則の違反は `maintainability` ジョブの `rule_classes: purity` として検査記録（`summary.json`・`scan-run.json`）に残る（v1.0.0 の run には無い）。

| 規則 | 内容 | 設定 |
|---|---|---|
| `no-restricted-properties` | `Date.now`（時刻は clock として注入）・`Math.random`（乱数は注入）・`crypto.randomUUID`（ID 採番は idGenerator として注入） | error |
| `no-restricted-syntax` | 引数なしの `new Date()`（現在時刻を直接取らない） | error |
| `no-console` | `console` の直接使用 | error |
| `no-undef`（推奨ルールに含む） | 未宣言のグローバル参照 | error |

**off にしている範囲**: composition root（`backend/src/main.js`・`frontend/src/main.js`の 2 件）、CLI の入口（`scripts/*/*.mjs` の 58 件と `perf/screen/measure.mjs`。ロジックは `lib/` に置き、そちらは規約の対象）、外形監視ジャーニー（`e2e/synthetic/**/*.js` の 2 件。合成データの識別子に時刻を使う）、k6（`perf/k6/**/*.js` の 8 件。Go 製ランタイムで注入できない）。

**グローバル変数**: ESLint にはモジュール直下の可変な変数を禁じる標準ルールが無く、検査していない。筆者が `backend/src`・`frontend/src` の行頭の `let`・`var` を grep して 0 件を確認した（機械の継続検査ではない）。

**所見**: 純粋な層（`domain/`・`state.js`・`validation.js`・`messages.js`）は I/O も時刻も使わず、同じ入力で同じ結果になり、unit テストが注入で動く。純粋にできる所が副作用を持つ箇所は見つからなかった。

## inspection-22 フレームワーク規約の準拠

**結論**: **フレームワーク固有の lint・規約検査は無い**。採用しているフレームワークは backend の **Fastify 5.12.5**（ほかにテストの Playwright・node:test、配信の nginx）。frontend は React・Vue などを使わない静的 HTML / ES modules で、該当する規約が無い。Fastify に対しては、規約として明文化もしておらず、専用のプラグイン検査も入れていない。**ただし「やってはいけない書き方」の一部は、テストと契約検査で固定している**。

| Fastify の規約・落とし穴 | 守っている実装 | 固定している検査 |
|---|---|---|
| 本文サイズの上限を明示する | `bodyLimit: 1 MiB`（`app.js`）。超過は 400 で返し、応答を確実に届けるため上限付きで読み捨てる | `backend/test/api/robustness.test.js`・TC-031 |
| エラーを一箇所で整形する | `setErrorHandler` と `setNotFoundHandler` で契約の `Error` スキーマに統一 | `contract.test.js`（コードと契約の突き合わせ） |
| リクエスト ID・構造化ログ | `genReqId`、pino の JSON ログ | `observability.test.js` |
| 登録したルートが契約と一致する | `onRoute` フックで `registeredRoutes` を集める | `contract.test.js`（実装のルートと `openapi.yaml` の paths の突き合わせ） |
| 終了処理 | SIGTERM・SIGINT で `app.close()` | `main-process.test.js` |

**使っていない機能**: Fastify の route `schema`（JSON Schema による検証・直列化）は使っていない。入力検証は `domain/`・`http/` の自前の関数で、契約の検証は ajv を使う契約テスト。`dependency-selection.yaml` の fastify の選定理由は「スキーマによる検証が標準」と書くが、実装は使っていない（食い違いとして依頼表に書く）。

**`ai-context.yaml` との関係**: `framework` は期待する検査（`expected_checks`）に含めず、`not_expected` に「Fastify 用の専用 lint・規約検査は無い。できていないことで、承認された対象外ではない」と理由つきで残した（本書と一致。横断整合の PR）。`security/expected-scans.yaml` にも `framework` の検査は無い。

**検査の無い理由**: ESLint の Fastify 用プラグインは導入しておらず、静的に検査するだけの規模（ルート 5・ファイル 12）でもないと判断してきたが、**この判断は文書化もレビューもされていない**。nginx の設定は `nginx -t` 相当の検査や専用の lint を持たず、ZAP のヘッダ検査・E2E・compose テストで間接的に見る。

## inspection-23 依存ライブラリの選定妥当性

**結論**: 直接依存の選定理由・検討した代替・保守状況・扱いは [dependency-selection.yaml](../security/dependency-selection.yaml)（**20 件**。tooling 7・test 6・base-image 3・builtin 2・runtime 1・internal 1。以前は 17 件）に記録され、**180 日を過ぎると `check-policy` が CI で失敗する**。**以前は台帳に無い直接依存が 3 件あったが、PR #57 で追加し、`check-policy` が package.json・Dockerfile・compose と照合するようになった**（下記）。archived な依存は 0 件。

**台帳の中身**: 各件に reason・alternatives（2〜4 案）・maintenance（最新版と公開日・最終 push・star・archived か・ライセンス・勧告の履歴）・handling（扱いと再検討の条件）・last_checked がある。

| 気になる点 | 扱い（台帳の記載） |
|---|---|
| `ajv-formats` 3.0.1: 最終リリース 2024-03-30（約 2.5 年更新なし） | 継続利用と決めた。根拠: テスト専用で出荷物に入らない・ajv と同じ organization の公式拡張・勧告なし・自前定義への置換が小さい（約 10 行）。再検討: 勧告が出る・ajv の major 更新で非互換・さらに 12 か月更新なし |
| `fastify` 5.12.5: 2026-09 に high を含む複数の勧告が短期間に公開・修正 | 継続利用。固定版は勧告の影響範囲外（Advisory Database で確認）。Dependabot 週次。再検討: 修正が 90 日以上止まる・メンテナ体制の変更 |
| `happy-dom` 20.14.6: 過去に critical を含む勧告が複数 | 継続利用。信頼できないコードを実行する使い方で問題になるもので、本プロジェクトは自分たちのコードの描画テストだけに使い、本番に入らない |
| `node:sqlite`: 組み込み（API が安定途上の可能性） | 継続利用。Node 更新時にテストで確認。再検討: 互換性が崩れる・性能要件を満たせない |
| `@redocly/cli` 2.62.1: 依存が多い（約 140 パッケージ） | 継続利用。SBOM・osv・trivy が監視。再検討: 未修正の high 以上が残り続けるとき |

**台帳に無かった直接依存（実際に照合して見つけた不備。PR #57 で解消）**:

| 直接依存 | 場所 | 状況 |
|---|---|---|
| `lighthouse` 13.5.0 | `perf/screen/package.json` | **以前は台帳に無かった**（PR #57 で追加）。2026-10-12 に確認した範囲では最新版（npm の latest が 13.5.0）、GitHub の archived ではなく、ライセンスは Apache-2.0 |
| `playwright-core` 1.64.0 | `perf/screen/package.json` | **以前は台帳に無かった**（PR #57 で追加）。`@playwright/test` と同じ版・同じ保守元 |
| `mcr.microsoft.com/playwright:v1.64.0-noble`（base image） | `perf/screen/Dockerfile` | **以前は台帳に無かった**（PR #57 で追加。版は playwright-core と同じにそろえ、`check-policy` が検査） |
| `nginxinc/nginx-unprivileged`（frontend の base image） | `frontend/Dockerfile` | 台帳は `stable-alpine`（digest `15c994d10d6d…`）と記していたが、実際は **`stable-alpine-slim`（digest `3af0c10d960c…`）**だった。PR #57 で台帳を実際の記載（slim・digest）に直した |

以前の `check-policy` は台帳の各件の必須項目と日付だけを見て、package.json・Dockerfile との照合をしなかったため、この漏れを機械が検出できなかった。PR #57 で、package.json の依存（名前・版）と Dockerfile・compose のイメージ（digest）との照合を `check-policy` に足した（Playwright のイメージ版と playwright-core 版の一致も検査）。出荷物に入る直接依存は fastify の 1 つで、漏れていた 3 件は計測用（出荷しない）だった。

**定期見直し**: 180 日ごと（次回の期限は 2027-04-09）。Dependabot（週次）と security.yml が新しい版・勧告を検出する。archived・非推奨・12 か月以上の無更新・重大な勧告が繰り返されるものは、扱いと再検討の条件を書く規則。

## できていないこと・他の担当や管理者への依頼

| # | 依頼・課題 | 章 | 担当ロール（案） | 期限（提案） | 状態（2026-10-12） |
|---|---|---|---|---|---|
| 1 | gitleaks の誤検出（FND-012。指紋 `53576ce6ece1…`）を `triage.yaml` に fp で記載し、`gitleaks.toml` に allowlist を足す。FND の ID 登録（`assign-finding-ids.mjs`）も | 09・16・18 | セキュリティ担当 | 2026-10-19 | **完了**（allowlist は PR #42、fp の記載は PR #57、ID は FND-010〜012 登録済み）。**効果の確認（次の run で検出が無いこと）は ACT-010 で in_progress** |
| 2 | Ruleset（`main-protection`・`release-tags`）の適用と、適用後の実態スナップショットの保存（`docs/evidence/github/`）、効果の確認 | 13 | リポジトリ管理者（プロダクトオーナー） | 本書のレビューまで | **未完**（2026-10-12 に `gh api .../rulesets` が 0 件のまま） |
| 3 | `security.yml` の `file-security-issues` の条件式（push で skipped になる）の修正 | 14・18 | 運用（SRE）担当 | 2026-10-19 | **完了**（PR #57。`workflow_dispatch` の run 38158649674 で実行を確認） |
| 4 | `dependabot.yml` に `/e2e/synthetic`（npm）・`/perf/screen`（npm・docker）を追加 | 15 | 開発リード | 2026-10-31 | **完了**（PR #57。13/13。`/perf` の compose も追加。`check-policy` が照合） |
| 5 | `dependency-selection.yaml` に lighthouse・playwright-core・mcr の playwright イメージを追加し、nginx の記載を実際（slim・digest）に直す。`check-policy` に package.json・Dockerfile との照合を足す | 23 | セキュリティ担当 | 2026-10-31 | **完了**（PR #57。台帳 20 件） |
| 6 | release.yml で公開 digest を直接 trivy 検査する（検査と公開の同一性を機械で担保する） | 01・10 | 運用（SRE）担当 | 2026-11-30 | **完了**（PR #57。Release の dry-run run 38158428129 で確認）。**v1.0.0 には適用されていない**（次のリリースから）。実リリースでの動作は未確認 |
| 7 | ESLint の結果を `scan-run.json`（maintainability、しきい値つき）として残す。ai-context の `maintainability`・`framework` の記述を実態に合わせる | 02・19 | セキュリティ担当・QA リード | 2026-10-31 | **完了**（記録は PR #57、ai-context は横断整合の PR）。v1.0.0 の run の記録には無い |
| 8 | 層の依存方向の検査を CI に足す（設定ファイルに層を明示）。ADR を書く | 11 | 開発リード | 2026-11-30 | **検査は完了**（PR #57。`check-arch.mjs`・`architecture.yaml`）。**ADR は未作成** |
| 9 | 設定のずれ（`apply-settings.mjs --dry-run` の差分）を定期に検出する | 14 | 運用（SRE）担当 | 2026-11-30 | **未完** |
| 10 | Code Scanning の 4 アラート（#14〜#17）の dismiss の要否を決める。perf/screen イメージの検査、認証済み DAST の対象外承認を決める | 02・06 | セキュリティ担当・プロダクトオーナー | 2026-10-31 | **dismiss は完了**（PR #57。open 0・dismissed 4 を確認）。perf/screen イメージの検査と認証済み DAST の対象外承認は**未完** |
| 11 | 検査ツールの重複排除の鍵に「場所（イメージ）」を加える（別イメージの同じ CVE を dup にしない） | 16 | セキュリティ担当 | 2026-12-31 | **未完** |
