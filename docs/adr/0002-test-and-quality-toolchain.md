# ADR-0002: テスト・品質ツールチェーンの選定（なぜそれで、何を捨てたか）

- 状態: 採用（2026-10-11。記録は 2026-10-12 に起こした。選定は PR #7〜#32 の中で行い、その時点では本 ADR を書いていない）
- 決定者: QA リード（ツールの選定）、セキュリティ担当（検査ツール・依存の選定）、プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ）
- 関連: `security/dependency-selection.yaml`（直接依存ごとの選定記録）、`security/README.md`、`perf/README.md`、`monitoring/README.md`、`quality/README.md`、docs/01-test-plan.md の plan-05・plan-14

## 背景

本リポジトリは小さな ToDo アプリだが、QA/QC 成果物のお手本でもあるため、単体・API・E2E・負荷・外形監視・脆弱性検査を**実際に動かし、結果を証拠として残す**必要がある。
一方で、体制は単独のリポジトリオーナーと AI エージェントだけで（ADR-0004）、道具の保守に割ける手は少ない。次の制約を置いて選んだ。

- ツールは **CI とローカルで同じ版・同じコマンド**で動くこと（再現性）。検査ツールはコンテナイメージを tag + digest で固定する（`security/tools.env`、`perf/` の k6・Playwright）。
- 依存パッケージを増やさない。**検査ツール自身が供給網リスクとライセンス違反を持ち込まない**こと（下の SBOM・ライセンスの実例）。
- 公開リポジトリで無料の範囲に収める（GitHub Actions・GHCR・Code Scanning）。
- ホストに道具を直接入れない（Node・Python は mise、k6・Lighthouse・ZAP などは Docker イメージ）。

## 決定

| 目的 | 採用 | 主な理由（一次情報） |
|---|---|---|
| 単体・API テストのランナー | **`node:test`**（Node 24 組み込み）+ `node:assert`。カバレッジも `--experimental-test-coverage`（行 90% 未満で失敗） | ランナーを足さずに済み、依存ゼロ。JUnit 出力・カバレッジ・並列を標準で持つ（`backend/scripts/run-tests.js`、`frontend/package.json`）。 |
| 画面の単体テストの DOM | **happy-dom**（テスト専用） | ブラウザを起動せず速い。外部の入力を読まず自前コードの描画だけに使う（`dependency-selection.yaml`）。 |
| E2E・互換・a11y | **Playwright**（chromium・firefox・webkit・360px の 4 project + compose）と **@axe-core/playwright** | 3 ブラウザ・モバイル幅・trace/video・並列・JUnit を 1 つで賄い、`retries: 0` とテストごとの専用スタックに向く（`e2e/playwright.config.js`）。axe で名前・ラベルを毎回の回帰にする。 |
| API 契約の検査 | **OpenAPI を正本**（`backend/openapi.yaml`）+ **ajv / ajv-formats**（応答検証）+ **@redocly/cli**（lint）+ **oasdiff**（破壊的変更） | 契約先行で、実装との食い違いを機械で検出する（RISK-008）。 |
| 負荷・性能 | **k6**（Docker、digest 固定）。画面は **Playwright + Lighthouse**（Docker） | 到着率固定のオープンモデル（`perf/README.md` 設計判断 1）を書け、threshold と JSON 出力を持つ。結果の判定は `scripts/perf/verdict.mjs` が正本で、k6 の threshold は早期警告。 |
| 外形監視 | **自作の Monitoring as Code**（`scripts/monitoring/`、依存は `yaml` のみ）+ Playwright のブラウザジャーニー + GitHub Actions（30 分間隔）+ GitHub Issue 通知 | 本番が無く SaaS の外形監視を契約しない。リリース済みイメージを runner で起動して監視する（`monitoring/README.md` 設計判断 1）。 |
| SAST | **CodeQL**（javascript-typescript、security-extended） | GitHub の Code Scanning にそのまま載り、公開リポジトリで無料。 |
| Secret | **gitleaks**（git 履歴全体）+ GitHub secret scanning・push protection | 履歴全体を走査でき、SARIF を出せる。 |
| SCA・SBOM | **npm audit** + **osv-scanner** + **`npm sbom`**（組み込み、CycloneDX）+ **dependency-review** | 2 つの勧告 DB を突き合わせる。SBOM は依存が増えない組み込みを選んだ。 |
| コンテナ・IaC | **Trivy**（fs・image ×2）+ **hadolint** + 自前の compose 検査 | イメージの脆弱性・設定誤り・SBOM を 1 つで出せる。 |
| DAST | **OWASP ZAP**（baseline + API 走査、認証なし） | 認証なしが全攻撃面（REQ-015）で、openapi.yaml を API 走査に渡せる。 |
| ライセンス | **自作の評価**（`scripts/security/license-check.mjs`。lock と node_modules の license を許可リストで評価） | 既存ツールの推移依存が方針違反になったため（下記）。 |
| ワークフロー統制 | **actionlint** + 自作 `check-workflows.mjs`（W1〜W10）+ action の SHA 固定 | 権限・固定・信頼できない値の埋め込みを機械で検査する。 |

あわせて次を決めた。

- **道具の更新は PR 経由**: `tools.env`（digest）、`package-lock.json`、action の SHA は Dependabot（週次）と PR のレビュー（CODEOWNERS）で更新する。
- **直接依存は `security/dependency-selection.yaml` に選定理由・代替・保守状況を書き、180 日ごとに見直す**（期限切れは CI が失敗）。
- **ゲートは 2 つの集約ジョブ**（`ci-result`、`security-result`）。個別ジョブ名を required にしない（ADR-0004）。

## 影響

- 良い点: 道具が少なく、ほとんどが組み込みか digest 固定のコンテナで、CI とローカルが同じ結果になる。検査ツールが増やす依存が最小で、供給網の面が小さい。
- 悪い点・限界（正直に）:
  - **自作の道具が 3 つ**（外形監視、ライセンス評価、ワークフロー統制）ある。保守するのはこのリポジトリで、単体テストはあるが、既製品ほど使い込まれていない。
  - `node:sqlite` は Node 24 では実験的な段階の可能性があり、Node 更新のたびに永続化テストで確かめる必要がある（ADR-0003）。
  - Playwright の Firefox は **macOS の開発機では動かず、Linux の CI（ubuntu-24.04）で実行**している。開発機だけでは 3 ブラウザの確認が完結しない（docs/01-test-plan.md plan-07）。
  - 実機（iOS Safari・スクリーンリーダー）は自動化できず手動の TC-071・TC-072 に残り、**未実施**（docs/evidence/manual-plan.yaml、ACT-004）。
  - k6 の負荷生成と被試験が同じホストの CPU を共有するため、絶対値は本番の予測値ではない（`perf/environment.md`）。
- ツールを替える・足す条件: 保守状況が `dependency-selection.yaml` の再検討条件に当たったとき、またはツールの出力が証拠として使えなくなったとき（SARIF・JUnit・CycloneDX の形式を保てるものに限る）。

## 却下した案

選定時に比較表を残したのは `dependency-selection.yaml` に書いた直接依存だけである。下表のうち「記録あり」は同ファイルの `alternatives` に書いた内容、「事後整理」は当時の比較記録が無く、決定後に理由を整理したものである。

| 案 | 却下の理由 | 根拠 |
|---|---|---|
| Vitest / Jest（単体） | ランナーと周辺の依存が増える。`node:test` で JUnit・カバレッジ・モックが足りた | 事後整理 |
| Cypress（E2E） | WebKit 対応が限定的で、複数ブラウザの並列実行が有料機能に寄る | 記録あり |
| Selenium / WebDriver | 待機・レポート・trace を自前で組む必要がある | 記録あり |
| jsdom（単体の DOM） | happy-dom より重く依存が多い | 記録あり |
| zod / 手書き assert（契約検証） | openapi.yaml が正本でなくなる／契約と実装のずれを検出できない | 記録あり |
| Spectral / vacuum（OpenAPI lint） | 組み込みルールの網羅が Redocly より狭い／設定資産が少ない | 記録あり |
| JMeter / Gatling / Artillery 等（負荷） | ホストへの導入や JVM を避けたかった。k6 は Docker 1 イメージで、到着率固定を書ける | 事後整理（比較の実測はしていない） |
| SaaS の外形監視（Datadog Synthetics 等） | 本番が無く、契約・資格情報・費用が増える | 事後整理 |
| `@cyclonedx/cyclonedx-npm`（SBOM） | 推移依存が約 100 パッケージ増え、libxmljs2 → nan（DCO）や normalize-package-data（JSON）がライセンス方針に違反した。いったん採用し、dependency-review の指摘で外した | 記録あり |
| `license-checker-rseidelsohn`（ライセンス） | 推移依存の spdx-satisfies（GPL-2.0-only を含む式）・nan が方針違反で、Scorecard の警告も出た。依存ゼロの自作に置換し、約 260 パッケージ減った | 記録あり（`security/README.md`） |
| Snyk / SonarQube 等の SaaS 検査 | アカウント・トークンが要り、公開リポジトリで無料の GitHub 標準（CodeQL・dependency-review）と OSS ツールで足りた | 事後整理 |
| ホストへ k6・Lighthouse・ZAP を直接導入 | ホスト環境を個別プロジェクトに依存させない方針に反する。Docker イメージを digest 固定で使う | 事後整理 |
