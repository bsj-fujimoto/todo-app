# docs/ 成果物の索引

| 項目 | 内容 |
|---|---|
| 文書ID | DOC-INDEX（成果物 13 本の索引。番号付きの成果物ではない） |
| 版 | 1.1 |
| 更新日 | 2026-10-12 |
| 状態 | draft（オーナーの確認待ち。PR マージ＝承認の代行） |
| 対象 | todo-app 仕様書 v1.1、リリース v1.0.0（commit 5fcf40a7e58dc253e53ff56860d0669a69abda26） |
| 作成 | ドキュメント管理担当（AI が作成） |
| レビュー | QA リード（ロール。兼務） |
| 承認 | プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ。オーナーの確認が済むまで draft のまま） |
| 正本 | この md と [ai-context.yaml](ai-context.yaml)（Git が版管理） |

todo-app（frontend nginx + backend Fastify/SQLite、docker compose）の **QA/QC 成果物 13 本**と、その元になる台帳・証跡の置き場を示す。
**書いてある文書のリンクだけを張る。まだ無い文書は「作成中」とだけ書き、リンクにしない**（リンク切れを作らない。`node scripts/ci/docs-check.mjs` が検査する）。
2026-10-12 時点で本文があるのは 01〜06・08〜13 の 12 本（すべて draft。オーナーの確認待ち）。**07（性能）だけが作成中**（GitHub 上の性能の本計測の取り込み後に作成する）。できたらこの表を更新する（更新規則を参照）。

## 1 成果物の索引（13 本）

| 番号 | 成果物 | 状態 | 行・値の正本（本文は方針・判断・読み方） |
|---|---|---|---|
| 01 | [テスト計画書（plan）](01-test-plan.md) | あり（draft） | `docs/data/risks.csv` ほか |
| 02 | [テスト観点表（perspective）](02-test-perspectives.md) | あり（draft） | `docs/data/perspectives.csv`・`requirements.csv`・`risks.csv`・`unknowns.csv` |
| 03 | [テスト仕様書（spec）](03-test-spec.md) | あり（draft） | `docs/data/cases.csv`・`datasets.csv` |
| 04 | [リグレッションテスト成果物（regression）](04-regression.md) | あり（draft） | [quality/](../quality/README.md)（`journeys.yaml`・`impact-map.yaml`・`regression-suite.csv`・`flaky-ledger.yaml`） |
| 05 | [自動テスト成果物（automation）](05-automation.md) | あり（draft） | `.github/workflows/`・`quality/`・`e2e/`・`backend/test/`・`frontend/test/` |
| 06 | [APIテスト成果物（api）](06-api-test.md) | あり（draft） | `backend/openapi.yaml`・`backend/test/`・`scripts/ci/oasdiff-breaking.sh` |
| 07 | 負荷・性能試験成果物（performance） | 作成中（性能の本計測の取り込み後。リンクなし） | [perf/](../perf/README.md)（`slo.yaml`・`workload.yaml`・`baseline.json`・`k6/`） |
| 08 | [テスト対象の検査結果レポート（inspection）](08-inspection.md) | あり（draft） | [security/](../security/README.md)・`docs/evidence/security/`・`docs/data/findings.csv` |
| 09 | [テスト実施・結果記載（execution）](09-test-execution.md) | あり（draft） | `docs/data/executions.csv`・`defects.csv`・`docs/evidence/runs/` |
| 10 | [テスト品質報告書（quality）](10-quality-report.md) | あり（draft） | `docs/data/` の各 CSV と `docs/evidence/` の集計 |
| 11 | [外形監視・運用品質成果物（monitoring）](11-monitoring.md) | あり（draft） | [monitoring/](../monitoring/README.md)（`monitors.yaml`・`runbooks/`・`fp-fn-log.md`） |
| 12 | [テスト結果分析レポート（analysis）](12-analysis.md) | あり（draft） | `docs/data/actions.csv`・`findings.csv`・`defects.csv` |
| 13 | [品質証跡・AIコンテキスト（evidence）](13-evidence.md) | あり（draft。証跡の実体は[evidence/](evidence/README.md)、AI 向け文脈は[ai-context.yaml](ai-context.yaml)） | `docs/evidence/`・`docs/data/evidence-index.csv`・`traceability.csv` |

### 成果物に付随するもの

| 置き場 | 内容 |
|---|---|
| [ai-context.yaml](ai-context.yaml) | AI 向けプロダクト文脈（製品・リポジトリ・戦略・対象外・未決・食い違い・AI の使い方規則）。2 章 |
| [data/](data/) | 表の正本（CSV）。要求・リスク・観点・ケース・未決・データセット（テスト設計）、実施・不具合・検出・アクション・証拠索引・追跡表（実施と証跡） |
| [adr/](adr/0001-frontend-backend-split.md) | アーキテクチャ判断（ADR-0001〜0006。0001: frontend / backend 分離と保存先の変更、0004: [単独メンテナ運用の統制](adr/0004-single-maintainer-governance.md)ほか） |
| [evidence/](evidence/README.md) | 実行結果から機械的に作る証跡（manifest・成果物台帳・正本の所在・run の成果物・セキュリティ検査の写し） |

## 2 AI 向け文脈 ai-context.yaml の位置づけ

[ai-context.yaml](ai-context.yaml) は、採点ツール qc-analyzer の正規化入力の `context`（product・repository・identifiers・strategy・inspection・
scope・exceptions・unknowns・contradictions・ai_policy）に当たる情報を、**1 つの機械可読ファイルに集めた索引と要約**である。

- 実体は持たない。値は転記ではなく、根拠のパス付きで要約している。食い違ったら、このファイルではなく参照先（正本）が正しい。
- 承認済みの対象外（exceptions）は、理由・承認者（ロール）・承認日・期限が揃ったものだけを置く。理由は `docs/01-test-plan.md`（plan-03）と一致させる。
- 仕様と成果物の食い違い（contradictions）は、実際に突き合わせた範囲と結果（食い違い無しを含む）を書く。
- 未決の実体は [data/unknowns.csv](data/unknowns.csv)。ここは管理規則と書いた日の要約だけ。

## 3 読み順

| 目的 | 読む順 |
|---|---|
| 製品と対象を知る | `spec/todo-phase1-spec.html`（仕様 v1.1）→ [adr/0001](adr/0001-frontend-backend-split.md) → [ai-context.yaml](ai-context.yaml) |
| テスト設計を追う | [02 観点表](02-test-perspectives.md)（要求 → リスク → 観点）→ [03 テスト仕様書](03-test-spec.md)（ケース）→ `data/*.csv` |
| 実施結果を確かめる | `data/executions.csv` → `data/evidence-index.csv`（主張 → 証拠）→ [evidence/README.md](evidence/README.md) |
| 運用の実態を知る | [quality/](../quality/README.md)（回帰）→ [perf/](../perf/README.md)（性能）→ [monitoring/](../monitoring/README.md)（外形監視）→ [security/](../security/README.md)（検査） |
| リポジトリの統制を知る | [.github/settings/README.md](../.github/settings/README.md)（Ruleset の設計と適用手順）→ [CONTRIBUTING.md](../CONTRIBUTING.md) |

## 4 ID 体系

| ID | 形 | 正本 |
|---|---|---|
| 要求 | `REQ-001` | `data/requirements.csv` |
| リスク | `RISK-001` | `data/risks.csv` |
| 観点 | `VIEW-001` | `data/perspectives.csv` |
| ケース | `TC-001` | `data/cases.csv`（テスト名の先頭にも付ける） |
| 未決 | `UNK-001` | `data/unknowns.csv` |
| データセット | `DS-001` | `data/datasets.csv` |
| 実施 | `EXEC-0001` | `data/executions.csv` |
| 不具合 | `DEF-005`（= Issue 番号 3 桁） | GitHub Issues（`data/defects.csv` は写し） |
| 検出（セキュリティ） | `FND-001` | `data/findings.csv` |
| アクション | `ACT-001` | `data/actions.csv` |
| 証拠 | `EV-0001` | `data/evidence-index.csv` |
| 成果物台帳 | `ART-01` | `evidence/artifacts.yaml` |
| ジャーニー・監視 | `J-01`・`MON-001` | `quality/journeys.yaml`・`monitoring/monitors.yaml` |

たどり方: 要求（REQ）→ リスク（RISK）→ 観点（VIEW）→ ケース（TC）→ 実施（EXEC）→ 不具合（DEF）→ 検出（FND）・アクション（ACT）。追跡表は `data/traceability.csv`。
**未解決の参照を作らない**（文書・CSV・Issue・コードの間。`node scripts/ci/docs-check.mjs` と `npm run evidence:check` が検査する）。

## 5 版管理と承認の流れ

1. **GitHub Flow**: `main` は常にリリース可能。短命ブランチ（`docs/…` `feat/…` `fix/…` `chore/…`）→ PR → CI が緑 → レビュー → squash マージ（[CONTRIBUTING.md](../CONTRIBUTING.md)）。
2. **PR**: テンプレート（`.github/PULL_REQUEST_TEMPLATE.md`）の確認項目（仕様・契約との整合、TC-ID を持つテスト、影響する成果物の更新、秘密情報なし）を満たす。
3. **必須チェック**: `ci-result` と `security-result`（`.github/workflows/ci.yml`・`security.yml` の集約ジョブ）。
4. **Ruleset（設計）**: PR 必須・承認 1 件 + code owner review・required checks・force push 禁止・ブランチ削除禁止・linear history（`.github/settings/ruleset-main.json`）。
   **2026-10-12 時点で Ruleset は未適用**（`gh api repos/bsj-fujimoto/todo-app/rulesets` が空）。したがって GitHub 側でこの統制は強制されていない。適用は管理者が
   [.github/settings/README.md](../.github/settings/README.md) の手順で行う。適用したら、この項と ai-context.yaml の `repository.expected_controls` を更新する。
5. **ロールと承認の実態**: 単独のリポジトリオーナー + AI エージェントで運用し、ロールは兼務（不在時の代理は置けない。制約）。
   「承認」はオーナーが PR をマージした時点で、**フェーズ1の PR のマージはオーナーの明示許可（2026-10-11）に基づく AI の代行**である。
   成果物の状態は `draft` / `reviewed` / `approved` / `obsolete`。承認が実際に無いものを `approved` にしない。
6. **版**: 文書のヘッダ表の「版」「状態」「承認」。履歴は Git（`git log`）が正本で、`evidence/artifacts.yaml` が成果物ごとの版・状態・sha256・変更履歴を台帳化する（生成物）。
   リリースはタグ `v1.0.0`。

ロール名: プロダクトオーナー／開発リード／QA リード／QA 担当／バックエンド担当／フロントエンド担当／セキュリティ担当／運用（SRE）担当／メンテナ。人名・アカウント名は文書に書かない。

## 6 証跡の読み方（docs/evidence）

詳細は [evidence/README.md](evidence/README.md)。要点だけ書く。

| 知りたいこと | 見る場所 |
|---|---|
| ある主張の証拠 | `data/evidence-index.csv` の `claim` → `ref`（`./docs/evidence/…#アンカー`）。`sha256` は実体のハッシュ |
| あるケースの結果 | `data/executions.csv`（TC × 環境）→ `evidence/runs/<run-id>/junit/` と `observations/`（テストが実際に見た値） |
| どの run のものか | `evidence/runs/<run-id>/SOURCE.json`（取得時刻・取得元 run の URL・対象 SHA・版） |
| 改変されていないか | `evidence/manifest.json`（全ファイルの sha256）。`node scripts/evidence/verify-manifest.mjs` で再計算 |
| 文書の版と承認 | `evidence/artifacts.yaml`（成果物台帳。承認の記録が無いものは `approved_by: null`） |
| 正本の所在 | `evidence/source-of-truth.yaml`（生成物） |
| セキュリティ検査 | `evidence/security/`（SARIF・SBOM・`scan-run.json`・`findings.json`・`gate.json`） |
| 手動ケースの未実施理由 | `evidence/manual-plan.yaml`（実施していないものは `not_run`。`pass` にしない） |

制約: 証跡は**テストが実際に見たことだけ**を示す。正規表現による秘密情報の検査は不在を証明しない。時間依存の事実（運用日数・履歴）はまだ短い（4 週間未満）。

## 7 正本の所在

| 対象 | 正本 | 備考 |
|---|---|---|
| 要求 | `docs/data/requirements.csv` | 行の正本は CSV。`docs/02` の表は写し |
| 画面・入力規則・エラー文言・受け入れ条件 | `spec/todo-phase1-spec.html`（v1.1） | フェーズ2は `spec/todo-phase2-spec.html`（v1.0.0 の対象外） |
| API 契約 | `backend/openapi.yaml` | 契約先行。実装との差分は CI の contract で検出 |
| アーキテクチャ | `docs/adr/` | |
| セキュリティ要求・検査方針 | `security/README.md` | |
| SLO | `perf/slo.yaml` | 機械可読。`evidence/source-of-truth.yaml` の SLO 欄も同じパス（`present`） |
| 観点・ケース | `docs/data/perspectives.csv`・`cases.csv` | |
| 不具合 | GitHub Issues（label: defect / flaky） | `docs/data/defects.csv` は写し。直接編集しない |
| 回帰・ジャーニー | `quality/journeys.yaml`・`impact-map.yaml` | `regression-suite.csv` は生成物 |
| 外形監視 | `monitoring/monitors.yaml` | |
| リポジトリ統制のあるべき姿 | `.github/settings/` | 実態は `gh api` の read-only スナップショット（`scripts/ci/snapshot-github.sh`）で確かめる |

**生成物は手で編集しない**（`artifacts.yaml`・`source-of-truth.yaml`・`manifest.json`・`defects.csv`・`regression-suite.csv`・`traceability.csv` など）。生成スクリプトで作り直す。

## 8 更新規則（変更影響の表）

変更を入れる PR は、同じ PR で影響する文書を直す。

| 変更 | 直す文書・台帳 |
|---|---|
| 仕様書（`spec/`）を変えた | `data/requirements.csv` → 観点（`perspectives.csv`）→ ケース（`cases.csv`）→ 02・03 の件数と表 → `ai-context.yaml` の contradictions と scope |
| `backend/openapi.yaml` を変えた | 06（API テスト）・`cases.csv`・`quality/impact-map.yaml`。破壊的変更は `oasdiff` が CI で止める。`monitoring/monitors.yaml` のスキーマ参照 |
| 画面・API の振る舞いを変えた | 該当ケース・外形監視の期待（`monitoring/`、`e2e/synthetic/`）を同じ PR で |
| ファイル・機能を足した | `quality/impact-map.yaml`（`impact-check` が落ちる）。回帰スイートを `node scripts/regression/build-suite.mjs` で再生成 |
| 重要ジャーニーを足した・変えた | `quality/journeys.yaml` → `monitoring/monitors.yaml`（journey_id）→ `ai-context.yaml` の `product.user_journeys` |
| SLO・性能の想定を変えた | `perf/slo.yaml`・`perf/workload.yaml` → 07 → `ai-context.yaml` の `slo_references` と `strategy.performance` |
| 検査の追加・削除・方針変更 | `security/expected-scans.yaml`・`security/README.md` → 08 → `ai-context.yaml` の `inspection` |
| Ruleset・リポジトリ設定を変えた／適用した | `.github/settings/` → この README の 5 章 → `ai-context.yaml` の `repository.expected_controls`（適用状況を実態どおりに） |
| 対象外（N/A）を足した・期限が来た | `ai-context.yaml` の `exceptions`・`scope`（理由・承認者・承認日・期限）と `docs/01-test-plan.md` の plan-03 を揃える |
| 未決を登録・解決した | `data/unknowns.csv`（owner・期限・決定内容）→ 関連ケース |
| CI の実行結果が変わった／リリースした | `npm run evidence:build` で `docs/data/` と `docs/evidence/` を再生成 → `ai-context.yaml` の `document.target_commit` と `as_of` |
| 成果物を新しく書いた | この README の 1 章（「作成中」を外してリンクにする）→ `evidence/artifacts.yaml`（再生成） |

### 変更後の確認

```fish
npm run lint
npm run format:check
node scripts/ci/docs-check.mjs
npm run evidence:check
```

`docs/` と `.github/` は prettier の対象外。
