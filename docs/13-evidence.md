# 13 品質証跡・AIコンテキスト

| 項目 | 内容 |
|---|---|
| 文書ID | DOC-13 |
| 版 | 1.1 |
| 更新日 | 2026-10-12 |
| 状態 | draft（オーナーの確認待ち。PR マージ＝承認の代行） |
| 対象 | todo-app 仕様書 v1.1（spec/todo-phase1-spec.html）、リリース v1.0.0（commit 5fcf40a7e58dc253e53ff56860d0669a69abda26） |
| 作成 | QA リード（ロール。証跡の設計・運用を兼務。実作業は AI エージェント） |
| レビュー | QA リード（未実施。作成者と同じ主体の兼務で、第二の目は無い） |
| 承認 | プロダクトオーナー（PR のマージをもって承認。フェーズ1は AI が代行マージ。オーナーの確認が済むまで draft のまま） |
| 正本 | この md と、[docs/evidence/](evidence/README.md)（証跡の実体）・[docs/ai-context.yaml](ai-context.yaml)（AI 向け文脈）・`docs/data/` の各 CSV・`scripts/evidence/`（Git が版管理） |

この文書は、品質レビューの根拠になる**証跡を、どの版に対して・どう固定し・どこに置き・どこまで改変から守れているか**を書く。
証跡の実体（CI の実行結果・台帳・表）は別の担当が `docs/evidence/` と `docs/data/` で管理しており、**ここは設計・運用・実態の記述**で、行や値は転記しない（値は出典を添えた要約。食い違ったら出典側が正しい）。
数字は、版 1.0 が 2026-10-12 に main（d2ea4ad 時点）と GitHub を read-only（`gh api` の GET・`gh release view`・`gh attestation verify`・`cosign verify`・ファイルの再計算）で数えたもの。**版 1.1（横断整合）では、台帳・表・manifest の件数と PR・commit の件数を、2026-10-12 17:00 JST に main（ac5feba。PR #60・#61 を含む）と `npm run evidence:build` の再生成後のファイルから数え直した**。**時間依存の事実（運用日数・履歴）はまだ短い**（v1.0.0 の公開から 4 日未満）。

## この文書の結論

- **対象版は 1 つに固定できている**: release v1.0.0 = 製品 commit `5fcf40a…` = イメージ digest 2 本（backend `sha256:87addb2e…`・frontend `sha256:c82e88ba…`）。実施表 111 行はすべてこの commit（evidence-01）。対象版でない旧 run の証跡 121 ファイル（run 38128562945、対象 52da4aa）は manifest に残るが、**`SOURCE.json` の `superseded_by` と manifest の `superseded_by` で「置き換え済み」の印を付けた**（実施表の行の根拠には使っていない。削除はしない＝履歴）。
- **review ID の規則を本書で定めた**（`QR-<YYYYMMDD>-<release>-<NN>`。例 `QR-20261012-v1.0.0-01`）。**規則に沿ったレビュー記録のファイルはまだ無い**（採点が走った時点で書く。置き場の提案は evidence-01）。
- **機械で確かめられること**: manifest 365 ファイルの sha256 は不一致・欠落・未登録 0、ID 参照は 3,485 件中未解決 0、証拠索引 373 件は参照がすべて解決し sha256 不一致 0、秘密・個人情報らしい値は簡易検査 383 ファイルで 0 件（evidence-02・04・05・09。2026-10-12 17:00 JST に `check-evidence.mjs --strict-artifacts` が PASS）。manifest・証拠索引の件数は、PR #61 で取り込まれた性能の証跡 88 ファイルを含む。
- **人が確認していないこと（上限が掛かる観点）**: 正本の真正性（evidence-03）、抽出の内容 parity（evidence-07）、秘密・個人情報の最終確認（evidence-09）、改変防止の実効性（evidence-11）。**いずれも確認者・確認日の記録は無い**（未実施）。
- **「改変防止された保管先」と言えるのは、署名済みイメージ（digest・cosign・provenance・Rekor）だけ**。Git 履歴と hash 台帳は**改変を検知できる**が、**防止は main の Ruleset が未適用**（`gh api repos/bsj-fujimoto/todo-app/rulesets` が空。ACT-008、期限 2026-10-16）のため管理者の履歴書換えを止められない。CI の artifact（90 日、2027-01-09 まで）と Release の添付は削除・差し替えができる（evidence-11）。
- **秘密・個人情報**: 取り込み時に墨消し（5 ファイル 103 箇所、元と墨消し後の sha256 を記録）。**ただし墨消し前の値は、Git 履歴（b800097 の `docs/evidence/security/`、メール形式 44 件）に残っている**。履歴からは消せない（evidence-09）。**公開 Release の `release-evidence.zip`（初版の時点では墨消し前の 4 ファイル・メール形式 46 件を含んでいた）は、2026-10-12 に墨消し済みの版へ差し替えた**（sha256 `75d2fa5c9b741efa24c40bf96a73b9331b7d9aae6da80f7c817cda02ec97021e`、墨消し 584 箇所・11 ファイル。元の版は削除した。[docs/evidence/README.md](evidence/README.md) の「リリースの添付」）。
- **追跡**: REQ 34・RISK 16・TC 77・EXEC 111・DEF 10・ACT 26 は追跡表にすべて載る。VIEW は 69 件中 12 件、FND は 12 件中 6 件が載らない（前者は全件が対象外、後者は対応不要。理由は evidence-04）。接続の欠落（gaps）は 13 行（evidence-04。以前は 7 行で、ACT-013〜015・023〜025 の追加で増えた）。
- **承認・履歴**: 成果物台帳 72 件（approved 6・reviewed 53・draft 13）。PR 41 件（マージ 36）のうち GitHub 上の Review 記録は 6 PR に計 11 件で**すべて COMMENTED、APPROVED は 0**。承認は「オーナーが PR をマージした時点（フェーズ1は AI の代行）」で、第二の目は無い（evidence-10）。文書 01〜06・08〜13 の状態は、オーナーの確認が済むまで `draft` のまま（reviewed・approved にしない）。
- **成果物台帳は再生成済み**（版 1.1）: 72 件すべての sha256 が現物と一致し、`--strict-artifacts` が PASS（初版の時点では文書 9 件が未登録・sha256 不一致 7 件だった）。文書を更新したら、コミット後に `npm run evidence:build` で再生成する運用は変わらない（evidence-02・10）。`docs/README.md`・`docs/ai-context.yaml` は台帳の種別規則（`typeOf`）に無く、台帳には載らない（evidence-02）。

## evidence-01 Review identity・対象版

**結論**: release・commit・イメージ digest・run・取得時刻は固定され、証跡と対象版の一致も機械で検査している。review ID の採り方を本書で定義した。レビュー記録のファイルが未了（旧 run は `superseded` の印を付けて整理した）。

**固定している対象版**

| 固定する対象 | 値 | 出典 |
|---|---|---|
| **release** | v1.0.0（GitHub Release。2026-10-11T15:46:54Z 公開。draft・prerelease ではない。2026-10-12 時点で唯一の Release） | `gh release view v1.0.0`、[Release v1.0.0](https://github.com/bsj-fujimoto/todo-app/releases/tag/v1.0.0) |
| **タグ** | `v1.0.0`（注釈付き・**未署名**。tag object `22dc56f8…`、2026-10-11T15:43:21Z。タグの Ruleset は**未適用**） | `gh api repos/bsj-fujimoto/todo-app/git/tags/22dc56f…` |
| **commit**（製品 commit X） | `5fcf40a7e58dc253e53ff56860d0669a69abda26` | [release.json](evidence/release.json)、`git rev-parse v1.0.0^{commit}` |
| **artifact digest**（backend） | `sha256:87addb2e3998f9c793e1c979f9b65d98d3cca98e1eea57be8c6ac28705f5a213` | `release.json`、Release 本文、`release-evidence.zip` の `images.json`・`deploy-marker.json` |
| **artifact digest**（frontend） | `sha256:c82e88bae5e0aeb7d04df9e31808d1d490cdc6bc01b98efe11db7cd9b526ee9a` | 同上 |
| **ビルドした run** | 38152472087（Release ワークフロー、event=push、ref=v1.0.0、attempt 1。2026-10-11T15:43:26Z 作成、conclusion=success、`head_sha` = X） | [runs/38152472087/SOURCE.json](evidence/runs/38152472087/SOURCE.json)、`gh api repos/bsj-fujimoto/todo-app/actions/runs/38152472087` |
| **日時**（取得時刻） | CI の成果物 2026-10-11T15:50:42.570Z、セキュリティの成果物 2026-10-11T16:15:54.625Z、Issue スナップショット 2026-10-11T16:19:01.094Z、release.json の記録 2026-10-11T15:53:40Z | 各ディレクトリの `SOURCE.json`、`release.json` |
| **取り込みコミット**（Y） | `d14c713`（PR #42。2026-10-11T16:30:20Z にマージ） | `git log` |

時刻は JSON では UTC（`Z`）、`git log` と成果物台帳では JST（`+09:00`）。v1.0.0 の公開は UTC では 2026-10-11、JST では 2026-10-12（00:46）。

**review ID の採り方**（本書で定める。この規則で採番した最初のレビューは `QR-20261012-v1.0.0-01`）

| 部分 | 規則 | 例 |
|---|---|---|
| `QR` | Quality Review。品質レビュー（採点を含む）1 回に 1 つ | `QR` |
| `YYYYMMDD` | 採点を始めた時刻（`captured_at`）の **UTC の日付** | `20261012` |
| `<release>` | 対象の release（`release.json` の `release`）。タグ前の途中レビューは `pre-<次の版>` | `v1.0.0` |
| `NN` | 同じ日付・同じ release の通し番号（01 から）。**やり直しても欠番にせず次の番号**にし、旧い ID は記録の `status: obsolete` にする（消さない） | `01` |

**レビュー記録**に固定する項目（1 レビュー 1 件。採点ツールの `meta` と `meta.target` に写す）

| 項目 | 値の採り方 | 本書時点の値 |
|---|---|---|
| `review_id` | 上の規則 | `QR-20261012-v1.0.0-01` |
| `captured_at` | 採点を始めた時刻（UTC、ISO 8601）。採点を実行する側が記録する | 採点が走った時点で記録（本書では確定しない） |
| `target.release` | `release.json` の `release` | `v1.0.0` |
| `target.commit_sha` | **製品 commit X**（`release.json` の `commit_sha`） | `5fcf40a7e58dc253e53ff56860d0669a69abda26` |
| `docs_commit`（追加項目） | レビュー開始時点の main の HEAD。成果物（`docs/`）の版を固定する | 本書作成時の main は `d2ea4ad`。本書のマージで進む |
| `target.artifact_digest` | backend の digest（採点ツールは 1 値だけ持つ）。frontend は `images` に残す | 上表の 2 値 |
| `standard_version` / `stage` | 採点基準の版・完成版か途中か。採点時に宣言する | 採点時に宣言 |

```yaml
# レビュー記録の形（提案。置き場は未作成。値は本書時点で確定しているものだけ）
review_id: QR-20261012-v1.0.0-01
status: draft            # draft / final / obsolete
captured_at: null        # 採点開始時に UTC で記録
target:
  repository: bsj-fujimoto/todo-app
  release: v1.0.0
  commit_sha: 5fcf40a7e58dc253e53ff56860d0669a69abda26
  artifact_digest: sha256:87addb2e3998f9c793e1c979f9b65d98d3cca98e1eea57be8c6ac28705f5a213
images:
  backend: sha256:87addb2e3998f9c793e1c979f9b65d98d3cca98e1eea57be8c6ac28705f5a213
  frontend: sha256:c82e88bae5e0aeb7d04df9e31808d1d490cdc6bc01b98efe11db7cd9b526ee9a
evidence_run: "38152472087"
docs_commit: null        # 採点開始時の main の HEAD
```

**対象版と証跡の一致**（2026-10-12 に確認）

| 検査 | 結果 | 出典 |
|---|---|---|
| 実施表の `commit_sha` の種類 | 1 種類（111 / 111 行が X）。2 種類以上、または `release.json` の SHA 以外の行があれば失敗 | `docs/data/executions.csv`、`node scripts/evidence/check-evidence.mjs --release 5fcf40a7e58dc253e53ff56860d0669a69abda26 --strict`（リリースの記録 PASS） |
| 証拠索引の `head_sha` | 373 件中 356 件が X（run 224・セキュリティ 44・性能 88）。11 件は Issue スナップショットを取った時点の main（`49c40cc`）、6 件は旧 run（`52da4aa`。`superseded` 印あり）。後者 2 種は主張の文面に対象 SHA を書いてあり、X の実施結果の根拠には使っていない | `docs/data/evidence-index.csv` |
| manifest の `head_sha` | 365 件中 X が 242 件（release の run 121 + セキュリティ 33 + 性能 88）、`52da4aa` が 121 件（旧 run。すべて `superseded_by: 38152472087`）、`49c40cc` が 2 件（Issue スナップショット） | [manifest.json](evidence/manifest.json) |
| 製品コードの変更 | X から main（ac5feba 以降。2026-10-12 17:00 JST の作業ツリー）まで `backend`・`frontend`・`docker-compose.yml`・`spec` の差分は 0。変わったのは文書・証跡・監視・CI 設定（`git diff --stat X HEAD -- backend frontend docker-compose.yml spec` が空） | `git diff` |
| イメージの署名・provenance | backend・frontend とも `cosign verify`（identity は `release.yml@refs/tags/v1.0.0`）と `gh attestation verify`（SLSA provenance の `sourceRepositoryDigest` = X）が成功 | 2026-10-12 に実行（下の evidence-11） |

**stale（取得後に原本が更新された）の検出**: 原本（`docs/`・`spec/`・CSV など）の最終コミット時刻（`git log -1 --format=%cI -- <path>`、台帳の `updated_at`）が、レビュー記録の `captured_at` より後なら STALE とし、再取得（再生成）してから採点し直す。成果物台帳自体の古さは `node scripts/evidence/check-evidence.mjs --strict-artifacts` が失敗にする（通常の CI は警告）。**現状、台帳は古い**（evidence-02）。

**できていないこと**

- レビュー記録のファイルが無い（上の形は提案）。置き場は `docs/evidence/reviews/<review_id>.yaml` を提案する（`docs/evidence/` は証跡担当の管理のため、依頼として最終報告に書く）。
- 旧 run（`runs/38128562945`、PR #26 の CI、対象 52da4aa）の 121 ファイルは manifest に残る（削除しない＝履歴）。**`SOURCE.json` の `superseded_by` と manifest の項目の `superseded_by: "38152472087"` で、置き換え済み（実施表・証拠索引の根拠ではない）と読める**ようにした（様式は [scripts/evidence/README.md](../scripts/evidence/README.md)）。ただし証拠索引の旧 run の 6 行は、EV の ID を変えないため主張の文面を書き換えていない（主張に対象 SHA 52da4aa が書いてある）。「別の版の証跡が混ざっていない」とは言えないが、混ざっている旨は機械で読める。
- manifest のセキュリティ 33 件は、`head_sha` が X なのに `version` が `pre-1.0.0` と付いていた（取り込み時に版を渡さず既定値になっていた）。**2026-10-12 に `security/SOURCE.json` の `version` を 1.0.0 に訂正し**（`corrections` に変更前・後・理由を記録）、`fetch-run.mjs` は以後 run の ref から版を決める。**PR #61 で取り込まれた性能の証跡 88 ファイルにも同じ問題があったので、`perf/SOURCE.json` も同様に 1.0.0 へ訂正した**（取得元の run 38152548008 はタグ v1.0.0 上。`corrections` に記録）。**対象版は `head_sha` を正とする**。
- `SOURCE.json` の `run_started_at`（2026-10-11T15:45:50Z）は ci-summary の開始時刻で、GitHub の run 作成時刻（15:43:26Z）とは異なる。**意味を [docs/evidence/README.md](evidence/README.md) と [scripts/evidence/README.md](../scripts/evidence/README.md) に注記した**（項目名は変えていない）。
- タグが未署名・未保護のため、タグの付け替えは**検知はできる**（実施表の SHA・digest・署名検証と食い違う）が**防止はできない**（ACT-008）。

## evidence-02 Artifact provenance・Hash

**結論**: 成果物台帳 72 件のすべてに sha256・版・更新日時・変更履歴・保存方針があり、証拠索引 373 件と manifest 365 件は sha256 つき。台帳の sha256 は 71 件すべてが現物と一致する（初版の時点では 60 件中 53 件で、7 件は台帳が古かった。版 1.1 で再生成した）。本リポジトリの原本はテキスト（Git 管理）で、変換元と変換先の対応は**生成スクリプトと元ファイルの sha256**で取る。

**原本と整理済みファイルの対応**

| 原本（版・hash の所在） | 整理済みファイル | 変換 | 対応の取り方 |
|---|---|---|---|
| 仕様書 `spec/todo-phase1-spec.html`（v1.1。台帳 ART-37） | `docs/data/requirements.csv`（REQ 34 件） | 人（AI）が読んで起こす | `requirements.csv` の `source_ref`（仕様の節）。**機械の突合は無い**（evidence-07） |
| `docs/data/*.csv`（表の正本） | `docs/NN-*.md` の表（写し） | 表を md に写す | `scripts/evidence/check-parity.mjs` が件数・列を突合（12 表・記載 10 件で一致） |
| CI の artifact（JUnit・観察値・`ci-summary.json`。run 38152472087） | `runs/38152472087/`、`executions.csv`、`evidence-index.csv` | `fetch-run.mjs` → `build-executions.mjs` | `SOURCE.json`（取得元 URL・対象 SHA・取得時刻）、証拠索引の `ref` と `sha256`、JUnit の層別件数と `ci-summary.json` の突合 |
| GitHub Issues（label: defect / flaky） | `defects.csv`（写し）、`github/defect-issues.json`（スナップショット） | `build-defects.mjs` | スナップショットの sha256 が manifest・証拠索引にある。`--offline` で同じ表を再生成できる |
| セキュリティの CI artifact（SARIF・SBOM・`findings.json`） | `docs/evidence/security/`、`findings.csv` | `fetch-run.mjs --kind security` → `build-findings.mjs` | `SOURCE.json`。**墨消しした 5 ファイルは `original_sha256`（元）と `redacted_sha256`（後）を両方記録** |
| 文書・設定ファイル（Git） | 成果物台帳 `artifacts.yaml` | `build-artifacts.mjs`（ヘッダ表と `git log` から生成） | 台帳の `source_sha256`・`version`・`history`（commit つき） |

**成果物台帳の集計**（[artifacts.yaml](evidence/artifacts.yaml)、72 件）

| 項目 | 件数 | 補足 |
|---|---|---|
| `source_sha256`（64 桁） | 72 / 72 | 現物と一致 72、不一致 0（初版の時点では不一致 7 だった。再生成で解消） |
| `version` | 72 / 72 | 文書ヘッダの版、`openapi.yaml` の `info.version`、ほかは `git:<短縮 SHA>`（56 件） |
| `updated_at`・`history` | 72 / 72 | `history` は計 167 件（1 件あたり 1〜5 件）。commit つき、`by` は役割（`maintainer`） |
| `retention_policy`・`immutable_store` | 72 / 72 | `immutable_store: true` は 72 件。**「Git 履歴は永続」の意味であり、Ruleset が未適用の間は強制されていない**（evidence-11） |
| `normalized_format` | 72 / 72 | md 28・yaml 24・csv 13・yml 2・html 2・toml 1・env 1・tsv 1 |
| `snapshot_*`・`normalized_*`・`parity` | 0 | 原本が Git 上のテキストで、**原本 = 整理済みファイル**（変換していない）。取得時刻の代わりに `updated_at`（commit 時刻）を使う |

**台帳に載っていないもの**: 初版の時点では、成果物 04・05・06・08・09・11・本書が台帳の生成後に main へ入ったため未登録だった（再生成で載った）。**現在も載らないのは `docs/README.md` と `docs/ai-context.yaml`**（台帳の種別規則 `typeOf` に無い。台帳の欠落ではなく規則の範囲。`ai-context.yaml` は AI 向けの正本なので、台帳に載せるかは判断が要る＝依頼）。再生成までの間は `check-evidence.mjs` が「成果物台帳が最新でない」と警告する（`--strict-artifacts` なら失敗）。

**できていないこと**: `artifacts.yaml` に `parity`・`normalized_path`・`snapshot_captured_at` を持たせていない（採点ツールが読む形との差。evidence-07・11）。

## evidence-03 Source of Truth index

**結論**: 採点ツールが見る 9 項目すべてに正本の所在があり、所在のファイルは実在し、台帳の ART-ID も解決する（9 / 9）。**真正性（本当にそれが正本か）を人が確認した記録は無い**。

| 項目（slot） | 正本の所在 | 台帳 ID | 備考（写し・派生物） |
|---|---|---|---|
| 要求（`requirements`） | `docs/data/requirements.csv` | ART-13 | `docs/02` の表は CSV から作った写し（食い違うときは CSV が正） |
| UI（`ui`） | `spec/todo-phase1-spec.html`（v1.1） | ART-37 | 画面・入力規則・エラー文言・受け入れ条件。フェーズ2の `spec/todo-phase2-spec.html` は v1.0.0 の対象外 |
| API（`api_spec`） | `backend/openapi.yaml` | ART-01 | 契約先行。実装との差分は CI の contract で検出 |
| アーキテクチャ（`architecture`） | `docs/adr/`（ADR-0001〜0006） | ART-04・56〜60 | ディレクトリ配下の全 ADR |
| セキュリティ要求（`security_requirements`） | `security/README.md` | ART-25 | 検査の方針・重大度と SLA・トリアージ規則 |
| SLO（`slo`） | `perf/slo.yaml` | ART-52 | 性能・可用性の目標（実測ではなく想定に基づく社内目標） |
| 観点（`test_perspectives`） | `docs/data/perspectives.csv` | ART-12 | 行の正本は CSV |
| ケース（`test_cases`） | `docs/data/cases.csv` | ART-06 | 行の正本は CSV |
| 不具合（`defects`） | **GitHub Issues（label: defect / flaky）**。`docs/data/defects.csv` は写し | ART-08 | `source-of-truth.yaml` の `path` は CSV、`authoritative_source` が Issues。スナップショット `docs/evidence/github/defect-issues.json` から再生成できる派生物 |

出典: [source-of-truth.yaml](evidence/source-of-truth.yaml)（生成物。所在は `scripts/evidence/lib/source-of-truth.mjs`）。ほかの所在（ジャーニー `quality/journeys.yaml`、外形監視 `monitoring/monitors.yaml`、リポジトリ統制のあるべき姿 `.github/settings/`、リリース `git tag v1.0.0`）は [ai-context.yaml](ai-context.yaml) の `source_of_truth.other_sources`。

**機械で確かめたこと**（2026-10-12）: 9 項目の所在が実在（9 / 9）、台帳の ART-ID が解決（14 件の ID がすべて台帳にある）、`check-evidence.mjs` の「成果物台帳・正本の所在地が文書の現状と一致する」が PASS（非 strict。台帳が古いことは警告で、`--strict-artifacts` なら失敗する）。
**SLO の欄**: 以前は `status: missing` だったが、現在の `source-of-truth.yaml` は `perf/slo.yaml` を `present` と書き、実態と一致する。`ai-context.yaml` の食い違い C-001 と `docs/README.md` 7 章の注記は、版 1.1（横断整合）で**解消済みに直した**（C-001 は `contradictions.resolved` に移し、README の注記は削除した）。

**真正性の確認（人）**: 次の 3 点を人が確かめて、確認者（ロール）・日付を下の欄に書く。**現在は未実施**。

| 確認する点 | 確認者・確認日 | 結果 |
|---|---|---|
| 各所在が main にあり、現行の版か（古い写しを正本にしていないか） | 未実施 | — |
| 写し（`docs/02` の表、`defects.csv`、`source-of-truth.yaml`）が正本と食い違っていないか | 未実施（件数・列は `check-parity.mjs` が機械で突合済み。内容は人） | — |
| 正本ごとに更新の責任ロールと更新手順が決まっているか（`docs/README.md` 8 章の更新規則） | 未実施 | — |

## evidence-04 ID・Traceability

**結論**: 要求 → リスク → 観点 → ケース → 実施 → 不具合 → 検出 → アクションが ID で接続され、**参照 3,485 件の未解決は 0**（2026-10-12 17:00 JST）。接続の欠落は 13 行（gaps）で、理由つきで残している（初版の時点では 7 行。ACT-013〜015・023〜025 が追加されたため増えた）。

**チェーン**: `REQ` → `RISK` → `VIEW` → `TC` → `EXEC` → `DEF` → `FND` → `ACT`（`EV` が主張ごとに証拠へ紐づく）。形は固定（`REQ-001`・`EXEC-0001`・`DEF-005`＝Issue 番号 3 桁・`FND-001`・`EV-0001`・`ART-01`。[docs/README.md](README.md) 4 章、[ai-context.yaml](ai-context.yaml) の `identifiers`）。

| ID | 定義の件数 | 追跡表に載る | 載らないもの |
|---|---|---|---|
| REQ（`requirements.csv`） | 34 | 34 | なし |
| RISK（`risks.csv`） | 16 | 16 | なし（RISK-009・RISK-012 は「対応するケースがない」行として載る） |
| VIEW（`perspectives.csv`） | 69 | 57 | 12 件。**すべて `not_applicable`**（VIEW-023・024・026・029・042・046・055〜060。理由は `rationale`、判断は [02 テスト観点表](02-test-perspectives.md) の対象外の節） |
| TC（`cases.csv`） | 77 | 77 | なし |
| EXEC（`executions.csv`） | 111 | 111 | なし |
| DEF（`defects.csv`） | 10 | 10 | なし |
| FND（`findings.csv`） | 12 | 6 | 6 件（FND-001・004・005・006・008・009）。いずれも `status: na`（info・low で対応不要と判断した検出。アクションに結び付けていない） |
| ACT（`actions.csv`） | 26 | 26 | なし |

**追跡表**（[traceability.csv](data/traceability.csv)）は 91 行 = ケース 77 行（TR-001〜077）+ ケースに結び付かないもの 17 行（TR-078〜094）。

| 種別 | 行 | 内容 |
|---|---|---|
| 接続の欠落（gaps） | 13 行 | TR-071・TR-072（手動ケース `not_run`。pass の実施行なし）、TR-078（RISK-009）・TR-079（RISK-012）（対応するケースがない）、TR-080（DEF-033。review で見つけた不具合で関連ケースがない）、TR-081（ACT-008）・TR-082（ACT-009）・TR-083（ACT-013）・TR-084（ACT-014）・TR-085（ACT-015）・TR-086〜088（ACT-023〜025。成果物 07 が追加）（ケース・検出・不具合に結び付かないアクション） |
| 検出 → アクション | 6 行 | TR-089〜094（FND-010・011・012・002・003・007 とアクション） |
| 追跡できるチェーンの例 | — | REQ-021・REQ-003・REQ-019・REQ-026 → RISK-003・RISK-006 → VIEW-018・003・008 → TC-008 → EXEC-0011・0012 → DEF-011・DEF-036 → ACT-011 |

欠落のうち、ケースを足すか対象外にするかは ACT-011（QA リード、期限 2026-11-15）、Ruleset は ACT-008（期限 2026-10-16）、性能 baseline は ACT-009（期限 2026-10-19）で追っている。

**検査**: `node scripts/evidence/check-evidence.mjs`（定義 744 件・参照 3,485 件・未解決 0。追跡表が元の表と一致すること）と `node scripts/ci/docs-check.mjs`（`docs/data` の ID 参照・テスト名の `[TC-xxx]` と `cases.csv`・Markdown の相対リンク）。CI の `docs-check` が PR のたびに実行する。**ID の形そのものの検査**（`REQ-` + 3 桁など）は採点ツールが `ai-context.yaml` の `identifiers` を使って行う。

## evidence-05 Evidence index

**結論**: 証拠索引 373 件のすべてに観点 ID（`criterion_id`）・sha256・取得時刻・対象 SHA があり、参照先 248 ファイルはすべて実在し、**sha256 不一致 0・解決しない参照 0**（2026-10-12 17:00 JST に再計算。初版は 285 件・160 ファイル。差の 88 件は PR #61 で取り込まれた性能の証跡）。ただし**統制の主張（Ruleset 未適用など）の証拠は、保存したスナップショットが無い**。

**読み方**（[evidence-index.csv](data/evidence-index.csv)。1 行 = 1 つの主張と、その証拠）

| 列 | 意味 |
|---|---|
| `evidence_id` | `EV-0001`。（参照, 主張）の組で固定。実施表・不具合表の `evidence_ids` がここを指す |
| `claim` | 主張（例: 「DEF-005 の起票内容（GitHub Issue #5。…）」） |
| `ref` | `./docs/evidence/…#アンカー`（ファイル + アンカー。アンカーは JUnit の TC-ID、`findings.json` の `F-002`、`defect-issues.json` の `issue-5` など）。**run は参照先のパス**（`runs/<run-id>/`）と `SOURCE.json` で分かる |
| `domain`・`criterion_id`・`type` | どの領域・観点の証拠か、証拠の種類（junit・observation・sarif・cyclonedx・issue など） |
| `sha256` | **参照先ファイルの実体**のハッシュ（墨消しした場合は墨消し後） |
| `captured_at`・`head_sha` | 取得時刻と、取得元 run の対象 SHA |

**集計**（373 件）: 参照にアンカーあり 131・ファイルのみ 242、参照先の異なるファイルは 248。参照先の内訳は run 38152472087 が 224 件、セキュリティ 44 件、性能 88 件、Issue スナップショット 11 件、旧 run 6 件。種類は junit 109・observation 109・json 88（性能）・scan-run 15・finding 12・issue 10・sarif 9・cyclonedx 5・coverage 4・triage 3・source 2・ci-summary 2・docs-check 2・selection 2・issue-snapshot 1。観点別は execution-05（109）・execution-06（109）・performance（88）・inspection-01（15）・inspection-16（15）ほか。
実施表の `evidence_ids`（異なる 218 件）と不具合表の `evidence_ids`（異なる 21 件）は、すべて索引に解決する（未解決 0）。索引のうち 145 件（セキュリティ・run 単位・性能の証拠。性能の 88 件を含む）は実施表・不具合表から直接は指されない。

**解決しない参照が 0 件であることの検査**

| 検査 | 内容 | いつ |
|---|---|---|
| `check-evidence.mjs` の証拠索引の検査 | 全参照のファイルの実在・アンカーの実在・sha256 の一致。**解決しない参照・ハッシュ不一致は失敗** | PR ごとの CI（`docs-check`）。リリースの `evidence-check` ジョブは構造だけ（`--structure-only`、版は固定しない） |
| `verify-manifest.mjs` | manifest の 365 件の sha256・size を再計算（不一致・欠落・未登録を検出） | CI と手元。2026-10-12 17:00 JST に 0 件を確認 |
| 実施表の検査 | pass 行は証拠 2 件（JUnit と観察値）つき、観察値に `commit_sha` と run id が行と一致 | `check-evidence.mjs`（実施表） |

**証拠が保存されていない主張**（正直に）

| 主張 | 現在の根拠 | 欠けているもの |
|---|---|---|
| main の Ruleset・タグの Ruleset は**未適用**（`gh api …/rulesets` が空、branch protection は 404） | 2026-10-12 の read-only の `gh api` の結果（[ai-context.yaml](ai-context.yaml) の `repository.expected_controls`、本書） | `docs/evidence/github/` に統制のスナップショット（`scripts/ci/snapshot-github.sh` の出力）が**無い**（ここには Issue のスナップショットだけ）。sha256 つきの証拠索引の行も無い |
| secret scanning・push protection が有効、Actions の既定権限が read | 同上 | 同上 |
| 画面の見た目 | 観察値のテキスト（画面の行・状態・通信・計測値） | 画面キャプチャは無い（テストが見ていないことは証拠に無い） |

## evidence-06 Machine-readable export

**結論**: Markdown・YAML・CSV・JSON・JUnit XML・SARIF・SBOM（CycloneDX と SPDX）のすべてを提供している。人が読む文書（md）の表の行は、CSV が正本で、md は機械生成の写しか要約。

| 形式 | 所在 | 件数・用途 |
|---|---|---|
| Markdown | `docs/NN-*.md`（成果物）、`docs/adr/*.md`、`docs/README.md`、`docs/evidence/README.md`、`scripts/evidence/README.md` | 人が読む文書。ヘッダ表と章見出しは機械で読める形（文書 ID・版・状態・承認） |
| YAML | `docs/ai-context.yaml`、`docs/evidence/{artifacts,source-of-truth,manual-plan}.yaml`、`backend/openapi.yaml`、`quality/*.yaml`、`perf/*.yaml`、`monitoring/*.yaml`、`security/*.yaml` | AI 向け文脈・台帳・契約・設定。生成物は手で編集しない |
| CSV | `docs/data/` の 12 表（requirements・risks・perspectives・cases・datasets・unknowns・executions・defects・findings・actions・evidence-index・traceability）、`quality/regression-suite.csv` | 行の正本 |
| JSON | `docs/evidence/` に 325 ファイル（性能の 88 ファイルを含む。`manifest.json`、`release.json`、`SOURCE.json`、`ci-summary.json`、`regression-selection.json`、`observations/`（テストが観察した値）、`security/**/findings.json`・`gate.json`・`scan-run.json`、`github/defect-issues.json`） | 証跡と台帳 |
| JUnit XML | `docs/evidence/runs/*/junit/` の 16 ファイル | テストの結果（ケースごとの成否・所要） |
| SARIF | `docs/evidence/security/**/*.sarif` の 10 ファイル（CodeQL・gitleaks・trivy ×3・hadolint・ZAP ×2・osv-scanner・compose-check） | 検査結果 |
| SBOM（CycloneDX） | `docs/evidence/security/**/*.cdx.json` の 4 ファイル（実行時依存・全体・backend・frontend のイメージ） | 依存の一覧 |
| SBOM（SPDX）・provenance（SLSA） | Release の添付 `release-evidence.zip` の `attestations/`（`sbom-backend.json`・`sbom-frontend.json`・`provenance-backend.json`・`provenance-frontend.json`） | イメージに付けた証明書類の写し |

- **Release の添付**: `release-evidence.zip`（**2026-10-12 に墨消し済みの版へ差し替え済み**。436,272 バイト、GitHub の記録する digest `sha256:75d2fa5c9b741efa24c40bf96a73b9331b7d9aae6da80f7c817cda02ec97021e`。差し替え前は 436,414 バイト・`sha256:992897dc…d9c7`）。中に 84 ファイル（manifest 83 件 + `manifest.json`）。zip 内 manifest は `redacted: true`・墨消し 584 箇所・11 ファイル。`docs/evidence/security/` の 32 ファイル（`SOURCE.json` を除く）は、**差し替え後の zip の同名ファイルとバイト単位で同一**（2026-10-12 に再計算して 32 / 32 一致。差し替え前は墨消し前の 4 ファイルが違っていた。evidence-09）。
- **再処理できること**: 台帳・表は `npm run evidence:build` で再生成でき、検査は `npm run evidence:check`（`--out` で JSON のレポート）で機械的に再実行できる。
- **できていないこと**: 採点ツール向けの単一の正規化 JSON（`normalized.json`）は、本リポジトリには置いていない（採点ツールが CSV・YAML・md から作る）。

## evidence-07 抽出Parity

**結論**: 本リポジトリには、スライド・表計算（xlsx）の原本は無い（原本は Git 上のテキスト）ため、「xlsx の結合セル・非表示行」の意味での抽出 parity は**対象外**。代わりに、**構造の parity（件数・列）は機械で突合し一致**している。**内容の parity（仕様書から要求を漏れなく起こしたか）は人の確認が要り、未実施**。

| 抽出（原本 → 整理済み） | 構造の parity（機械） | 内容の parity（人） |
|---|---|---|
| 仕様書（HTML）→ `requirements.csv`（REQ 34） | 突合なし | **未実施**（`source_ref` で節に辿れるが、取りこぼしの確認記録は無い。[02](02-test-perspectives.md) が REQ ごとの観点を表にしている） |
| CSV の表 → md の表（写し） | `check-parity.mjs`: md に書かれた件数（「N 件」の形）と表の行数、md に書かれた列の一覧と CSV の実際の列を突合。12 表・記載 10 件で一致、不一致 0 | 表の内容が CSV と同じかは、**行の中身まで機械では見ていない**（件数・列のみ） |
| CI の artifact → `executions.csv` | JUnit の層別件数と `ci-summary.json` を突合（取り込み漏れ・別 run の混入を検知）。観察値 109 件が pass 109 行と対応 | 観察値が期待結果を満たすかの読み比べは人（[09](09-test-execution.md) の execution-14）。未実施の独立した確認 |
| Issue → `defects.csv` | スナップショットから同じ表を再生成できる（`--offline`） | Issue 本文の語彙は `build-defects.mjs` が検査。内容の妥当性は人 |
| 取得物 → 墨消し後のファイル | `original_sha256` と `redacted_sha256` を記録（規則ごとの件数つき） | 墨消しで必要な情報を消していないかは人（件数は 103 箇所） |

- `parity_reviewed_by`（人が parity を承認した記録）は**無い**。台帳（`artifacts.yaml`）にも `parity` の項目を持たせていない（evidence-02）。**この観点は人の確認が上限（3）で、現状は確認記録が無いため、人が確認するまで満点を主張しない**。
- 人が確認するときの最小手順: ①仕様書の機能・入力規則・エラー文言・受け入れ条件（AC-01〜AC-07）を 1 つずつ数え、`requirements.csv` の `source_ref` と突き合わせる。②`requirements.csv` の件数（34）が [02](02-test-perspectives.md) の表の件数と一致すること（機械で確認済み）。③確認者・日付をこの章に書く。

## evidence-08 Unknown／N/A／Exception

**結論**: 未決・対象外・受容・隔離・未実施は、いずれも理由・owner（ロール）・期限・承認（または決定者）つきで記録されており、**期限超過は 0 件**（2026-10-12 時点）。ただし**表のセルには構造的な空欄が多く**（7 表で 15.6%）、「空欄 = 問題なし」とは読めない。

| 種別 | 正本 | 件数 | 理由 | owner | 期限 | 承認・決定 | 期限超過 |
|---|---|---|---|---|---|---|---|
| 未決（UNK） | [unknowns.csv](data/unknowns.csv) | 8（resolved 7・open 1） | `question` | `owner_role` | `due_date` | resolved は `resolution` に決定者・決定内容・解決日 | 0（open は UNK-002、プロダクトオーナー、2026-10-16） |
| 承認済み対象外（EXC） | [ai-context.yaml](ai-context.yaml) の `exceptions` | 5（EXC-001〜005） | `reason` | `approved_by` | 承認の有効期限 `expires_at` 2027-04-12。**見直し日 `review_by` は plan-03 と同じ**（EXC-001・004 は 2027-01-12、EXC-002 は 2026-10-16 ほか、EXC-003 は 2027-04-12、EXC-005 は 2026-12-31 または `/api/v2` 判断時。版 1.1 で追加） | プロダクトオーナー。**PR #40 のマージをもって承認（AI の代行）**。承認日 2026-10-12 | 0 |
| 対象外の観点（VIEW） | [perspectives.csv](data/perspectives.csv) | 12（not_applicable） | `rationale`（仕様 §01 の対象外・機能が無い・別成果物・時期が先） | `owner` | 仕様や構成が変わったとき | [02](02-test-perspectives.md) の対象外の節。**仕様に基づく部分は仕様の承認、それ以外は PR 承認** | 期限は事象ベース |
| 期限付き受容（AR） | [security/accepted-risks.yaml](../security/accepted-risks.yaml) | 3（AR-001〜003） | `reason`・到達可能性・補完統制 | `owner` | `expires_at` 2027-01-09 | 受容日 2026-10-11。追跡 Issue #22・#33、ACT-001・ACT-007（`accepted`） | 0 |
| flaky の隔離 | [quality/flaky-ledger.yaml](../quality/flaky-ledger.yaml) | 2（TC-073・TC-074） | `cause` | `owner` | `expires_at` 2026-11-10（`since` から 30 日以内） | Issue #25・#37。ACT-002・ACT-012 | 0（期限が切れると CI の docs-check が失敗） |
| 自動化の穴 | [quality/known-gaps.yaml](../quality/known-gaps.yaml) | 0 | — | — | — | — | 0 |
| 手動ケースの未実施 | [manual-plan.yaml](evidence/manual-plan.yaml)、実施表 | 2（TC-071・TC-072。`not_run`） | `reason`（実機でしか判定できない） | QA 担当 | `retest_due` 2026-10-31（**暫定**） | **対象外ではなく未実施**。ACT-004。承認された対象外として扱わない | 0 |
| アクション（ACT） | [actions.csv](data/actions.csv) | 26（open 18・in_progress 3・accepted 2・done 3。ACT-009・014 は版 1.1 で done、ACT-023〜026 は成果物 07 が追加） | `what` | `owner` | `due` | — | 0（最も早い期限は ACT-008 の 2026-10-16） |

**例外と未決が「期限内に解消されている」とは言えない点**: UNK-002（タスク件数の上限）と ACT-008（Ruleset の適用）は期限（2026-10-16）前の open。TC-071・072 は未実施のまま。受容 3 件・隔離 2 件は期限内に残っている（解消ではなく期限つきの保留）。

**空欄の意味**（[docs/data](data/) の 7 表の集計を数え直した値: セル 4,798 件中 空欄 748 件、15.6%。2026-10-12 17:00 JST に executions・requirements・cases・perspectives・defects・actions・findings の 7 表を数え直した。採点ツールが読む列は正規化の対応による）

| 表・列 | 空欄 | 意味 |
|---|---|---|
| `executions`: `defect_ids`・`reason`・`owner`・`retest_due` | 100〜109 / 111 | pass の行には不具合・未実施の理由・owner が無いのが正常。**`not_run` の 2 行では `reason`・`owner`・`retest_due` が埋まっている**（空欄 0） |
| `executions`: `evidence_ids`・`executed_at`・`executor` | 2 / 111 | 未実施の 2 行（実施していないので証拠・時刻・実施者が無い） |
| `requirements`: `validation_rules`・`state_machines` | 25 / 34 | 入力規則・状態遷移を持たない種類の要求 |
| `cases`: `manual_reason`・`combination_ref` | 75・63 / 77 | 手動でない・組合せ表を使わないケース |
| `perspectives`: `unknown_ids`・`risk_ids` | 66・6 / 69 | 未決が絡まない観点。`risk_ids` が空の 6 件はすべて対象外の観点（VIEW-055〜060） |
| `defects`: `fix_commit`・`closed_at`・`case_ids` | 3・3・1 / 10 | 未修正の 3 件（DEF-025・031・033）。`case_ids` が空の 1 件は DEF-033（review で見つけた不具合。理由は Issue に記載） |
| `actions`: `finding_ids` | 18 / 22 | セキュリティの検出に由来しないアクション |

**未記入だったもの（解消）**: `findings.csv` の FND-012（`status: untriaged`）は `owner`・`due` が空だった（ACT-010 に owner・期限がある）。**版 1.1 で、`security/triage.yaml` の FND-012 に owner（セキュリティ担当）・due（2026-10-19）を書き、`build-findings.mjs` が run の出力に無い owner・due を現在の台帳から補う形に直して再生成した**（ACT-010 と同じ値。status は run の時点の untriaged のまま）。
**N/A の記し方**: 参照 ID の列に `N/A` のような文字を入れると参照の解決が壊れるため、構造的な空欄は空のままにし、意味は上の表と各 CSV の列定義で示す。

## evidence-09 Access・Secret・Privacy

**結論**: 最小権限（workflow は読み取りが既定、書込みはジョブ単位で理由つき）、秘密情報を持たない運用（Actions の secrets 0 件）、取り込み時の墨消し、データ分類を守っている。**正規表現の検査は不在を証明せず、人の最終確認は未実施**。**墨消し前の値は Git 履歴に残っている**（Release の添付は 2026-10-12 に墨消し済みの版へ差し替えた）。

**最小権限**（2026-10-12 に確認）

| 対象 | 実態 | 出典 |
|---|---|---|
| GitHub Actions の既定権限 | `default_workflow_permissions: read`、`can_approve_pull_request_reviews: false`（Actions は PR を承認できない） | `gh api repos/bsj-fujimoto/todo-app/actions/permissions/workflow` |
| workflow の権限 | 7 本すべてで最上位が `permissions: contents: read`。書込みはジョブ単位（`security-events: write` は CodeQL・trivy・Scorecard の SARIF アップロード、`issues: write` は incident・flaky・security の Issue、`contents`・`packages`・`attestations: write` は `release.yml#publish` のみ） | `.github/workflows/*.yml`、許可リスト `security/workflow-policy.yaml`（逸脱すると `check-workflows.mjs` が CI を失敗させる） |
| OIDC（`id-token: write`） | `release.yml#publish` だけ（cosign keyless 署名と provenance の発行に必要な最小のジョブ） | `security/workflow-policy.yaml` の `id_token_write_jobs` |
| 使える action | `allowed_actions: selected`、**SHA 固定を GitHub 側でも強制**（`sha_pinning_required: true`） | `gh api repos/bsj-fujimoto/todo-app/actions/permissions` |
| 秘密の保管 | リポジトリの Actions secrets は 0 件。`secrets.GITHUB_TOKEN`（GHCR へのログイン）以外の秘密を workflow は使わない | `gh api …/actions/secrets`、`grep secrets. .github/workflows` |
| 証跡を集めるときの権限 | read-only（`gh run download`・`gh api` の GET・`gh release download`）。**書き込み系の API は呼ばない**（スナップショットも書き込みなし。`.github/settings/README.md`） | `scripts/evidence/fetch-run.mjs`、`scripts/ci/snapshot-github.sh` |
| 管理者の bypass | 設計は PR 経由のみ（Admin の `pull_request` モード）。**Ruleset が未適用のため、現状は管理者が直接 push できる状態**（ACT-008） | [.github/settings/README.md](../.github/settings/README.md)、ADR-0004 |

**秘密情報の除去**

| 層 | 内容 | 結果 |
|---|---|---|
| GitHub の secret scanning・push protection | enabled。アラート 0 件（non-provider patterns・validity checks は disabled。`ai-context.yaml` の `repository.entitlements`） | 2026-10-12 |
| gitleaks（Git 履歴全体、`security.yml`） | 既定ルール + allowlist 1 件（`sourcegraph-access-token` を `docs/evidence/`・`docs/data/` からだけ除く。理由は commit SHA の誤検出）。v1.0.0 の run の検出は 1 件（FND-012、`untriaged`。台帳には PR #57 で fp を追記済みで、次の run で確認する。ACT-010、期限 2026-10-19） | [security/gitleaks.toml](../security/gitleaks.toml)、[evidence/README.md](evidence/README.md) |
| 取り込み時の墨消し（`scripts/evidence/lib/redact.mjs`） | 人の氏名・メール・アカウント名・トークン形式・`password=` などの代入を `[REDACTED:…]` に置換。決定的。**5 ファイル 103 箇所**（SBOM 2 つ 80 箇所〔36 + 44〕、CodeQL の SARIF 18 箇所、gitleaks の SARIF 4 箇所、Issue スナップショット 1 箇所）。記録は `SOURCE.json` の `redactions`（元の sha256・墨消し後の sha256）、manifest の `redacted: true`・`original_sha256` | [security/SOURCE.json](evidence/security/SOURCE.json)、[github/SOURCE.json](evidence/github/SOURCE.json) |
| 簡易検査（`check-evidence.mjs`） | `docs/data/`・`docs/evidence/` の全テキスト 383 ファイルに、トークン形式・メール・メンション・オーナー名・電話番号・カード番号の正規表現と、JSON の個人情報のキーを適用。**許可リストの例外なし**。**0 件**（警告 1 件: gitleaks の SARIF に採点ツールの電話・カード番号の正規表現に当たる値 1 件。UUID の 0 の並びなどで、実在の個人情報ではない） | 2026-10-12 |
| 観察値の設計 | 利用者データは合成データのみ（[datasets.csv](data/datasets.csv)）。UUID は `{uuid}` に伏せる。サイズは目視できる大きさに制限 | `scripts/evidence/README.md` |

**墨消しの限界（正直に）**

| 残っている場所 | 内容 | 消せるか |
|---|---|---|
| **Git 履歴** | main の b800097（PR #26）の `docs/evidence/security/` に、墨消し前のセキュリティ証跡（run 38126925868）。メール形式の文字列 44 件（npm のスコープを除く）。d14c713 以降の main の現行ファイルは 0 件 | 履歴の書換えは force push 禁止の方針に反し、実施していない。**履歴からは消さない** |
| **公開 Release の添付** `release-evidence.zip` | 初版の時点では、墨消しした 4 ファイル（`gitleaks.sarif`・CodeQL の `javascript.sarif`・イメージの SBOM 2 つ）の**墨消し前の原本**（メール形式 46 件）を含んでいた。**2026-10-12 に墨消し済みの版で差し替え済み**（sha256 `75d2fa5c…`、584 箇所・11 ファイル。元の版は削除した） | 消した（差し替え済み）。元の値は Git 履歴・CI の artifact（90 日）に残る |
| CI の artifact | 元の取得物（90 日。2027-01-09 まで） | 期限切れで消える |

公開リポジトリの commit author は元々公開情報で、これらが新たに暴露したものではない（SBOM の分は依存パッケージの作者情報）。以前の [docs/evidence/README.md](evidence/README.md) は「元の取得物は CI の artifact（90 日）にだけある」と書いていたが、**版 1.1 で、実態（CI の artifact 90 日と Git 履歴に残る。Release の添付は差し替え済み）に直した**（`SOURCE.json` の `redaction_note` と生成スクリプトも同様）。

**データ分類**: アプリが扱うデータは `internal`（合成データのみ。個人情報・秘密情報を扱わない。`ai-context.yaml` の `product.data_classification`）。**リポジトリ・文書・証跡は `public`**（誰でも読める）。internal に当たるものは置かない（置く必要が出たら、非公開の保管先と分類を先に決める）。AI の扱いは `ai-context.yaml` の `ai_policy`（AI-05: 人名・アカウント名・メール・秘密情報を成果物に転載しない）。

**人の最終確認（上限 3）**: **正規表現による検査は、検出が 0 件でも秘密情報・個人情報が無いことを証明しない**。人が最終確認し、ポリシー準拠を記録する欄を下に置く。**現在は未実施**。

| 確認する点 | 確認者・確認日 | 結果 |
|---|---|---|
| `docs/data/`・`docs/evidence/` を、検査が見ない形（画像・難読化した値・氏名の別表記）まで目視で確認 | 未実施 | — |
| Release の添付 `release-evidence.zip` の墨消し前の値を、残してよいか判断（差し替えるか） | 差し替えは 2026-10-12 に実施済み（記録は [evidence/README.md](evidence/README.md)）。**差し替えた版の中身の人による確認は未実施** | — |
| gitleaks の FND-012 のトリアージ（誤検出の確定） | セキュリティ担当（ACT-010、期限 2026-10-19） | 対応中 |

## evidence-10 Approval・Change history

**結論**: 成果物 72 件のすべてに状態・更新日時・変更履歴（commit つき）があり、PR の履歴（41 件）から版の差分が追える。**承認は「オーナーが PR をマージした時点（フェーズ1は AI が代行）」で、第二の目による承認は無い**。

**承認と状態の定義**（`docs/README.md` 5 章）: 状態は `draft` / `reviewed` / `approved` / `obsolete`。**承認が実際に無いものを `approved` にしない**。承認者の記録は `approved_by`（無ければ `null`）。ロール名で書く（人名・アカウント名は書かない）。

| 状態 | 件数（成果物台帳 72 件） | 意味・根拠 |
|---|---|---|
| approved | 6 | ADR-0001〜0006（文書に「決定者」を書いたもの） |
| reviewed | 53 | 文書ヘッダの「状態」が無いファイル。PR を経てマージされ CI を通っているが、承認の記録は無い（`approved_by: null`） |
| draft | 13 | 文書 01〜13（ヘッダが `draft（オーナーの確認待ち。PR マージ＝承認の代行）`）。**マージ済みでも、オーナーの確認が済むまで draft のまま**（reviewed・approved にしない） |
| obsolete | 0 | 旧版として廃止した成果物は現在ない |

**履歴の取り方**

| 見るもの | 場所 | 内容 |
|---|---|---|
| 成果物の変更履歴 | [artifacts.yaml](evidence/artifacts.yaml) の `history` | `git log` 由来（日時・役割・変更・commit）。計 167 件。commit の件名に PR 番号（`(#42)`）が入るので PR に辿れる |
| 版 | 同 `version` | 文書の版、API の `info.version`、ほかは `git:<短縮 SHA>` |
| PR のマージ履歴 | `gh pr list --state all` | 41 件（マージ 36・マージせず閉じたもの 4: #24 は確認用、#27 と #58 は Dependabot の node 25 への提案の不採用、#29 は同題の #32 がマージ）。squash マージのみ（`allow_merge_commit`・`allow_rebase_merge` は false）。main の 37 commit のうち 36 は GitHub の署名が valid、1 件（初回の取り込み）は未署名 |
| レビュー | GitHub の Review 記録 | 6 PR（#19・#23・#26・#29・#32・#57）に計 11 件、**すべて COMMENTED。APPROVED は 0 件**（`reviewDecision` が空） |
| 承認 | PR のマージ | マージはオーナーのアカウントで 36 件。**フェーズ1の PR のマージはオーナーの明示許可（2026-10-11）に基づく AI の代行** |

**obsolete の扱い**: 文書ヘッダの「状態」を `obsolete`（または「廃止」）にすると台帳が `obsolete` を記録する。旧版は Git 履歴に残り（消さない）、`artifacts.yaml` の `history` で辿れる。旧い review ID は記録の `status: obsolete` にする（evidence-01）。**証跡側では、旧 run（`runs/38128562945`）の `SOURCE.json` と manifest の項目に `superseded_by` の印を付けた**（evidence-01）。

**できていないこと・既知の不具合**

- **第二の目が無い**: レビューと承認が同じ主体の兼務で、不在時の代理も置けない（制約）。ロールが兼務のため、「レビュー済み」の意味は「PR を経て CI を通った」であり、人の承認ではない。
- **ART-58（ADR-0004）の `approved_by` の誤りは解消した**: 以前は「1 件 + **code owner review**」で、ADR-0004 の本文の表（ヘッダ解析が冒頭 30 行の表を拾っていた）を取り違えた生成の不具合だった。`build-artifacts.mjs` の `parseDocHeader` を「`項目 | 内容` の表だけを読む」形に直し、決定者が複数のロールを並べる ADR（0002・0005・0006）は「承認」と書かれたロールを承認者にする形にした（単体テスト追加）。ADR-0001〜0006 の `approved_by` はすべて「プロダクトオーナー」。
- 成果物台帳の古さ（evidence-02）は再生成で解消した。
- `ai-context.yaml` の `document.status` は `draft（オーナーの確認待ち。PR マージ＝承認の代行）` に揃えた（文書 01〜13 と同じ書き方）。

## evidence-11 Retention・Integrity

**結論**: 保存期間・hash・取得時刻は管理している（hash 72 / 72・取得時刻 373 / 373 など）。**改変を防止できている保管先は、署名済みイメージ（digest・cosign・provenance・Rekor）だけ**で、Git 履歴は改変を**検知**できるが**防止**は Ruleset の適用待ち、CI の artifact と Release の添付は防止も外部検知も無い。**改変防止の実効性を人が確認した記録は無い**。

**保管先ごとの保存期間と保証**

| 保管先 | 保存期間 | 改変の検知 | 改変の防止 | 現状の限界 |
|---|---|---|---|---|
| **Git 履歴**（main。変更履歴・commit hash） | 永続（リポジトリが存在する限り）。保存方針は台帳の `retention_policy` | **できる**。commit hash は内容と履歴のハッシュで、clone を持つ人が突き合わせられる。main の commit 37 件のうち 36 件は GitHub の署名が valid | **設計は禁止**（`ruleset-main.json` が force push・削除・非 linear history を禁止）。**適用は未**（Ruleset 0 件、branch protection も 404）。**リポジトリ管理者は履歴を書き換えられる** | 外部のミラー・第三者の保持は確認していない。タグ `v1.0.0` は未署名・未保護 |
| **hash 台帳**（[manifest.json](evidence/manifest.json)。`path`・`sha256`・`size`・`captured_at`・`source`・`version`・`head_sha`、365 件） | Git と同じ | **できる**（`verify-manifest.mjs` が再計算。CI の `docs-check` も検証）。2026-10-12 に不一致・欠落・未登録 0 | できない | 台帳も同じリポジトリにあるため、**全体を書き換える人は台帳も再生成できる**。偶発的な改変・部分的な差し替えを検知するもので、悪意のある全面書換えは検知できない |
| **CI の artifact**（Actions） | **90 日**（`upload-artifact` 33 箇所すべてが `retention-days: 90`）。run 38152472087 の 30 件は 0 件失効、最も早い失効は **2027-01-09T15:43:27Z**。保持切れ後は Git に取り込んだ写しが残る | できない（取り込み時の sha256 と突き合わせる） | できない（**削除可能**） | 90 日で消える。`immutable_store: false` |
| **Release の添付**（`release-evidence.zip`） | 永続（削除されるまで） | 部分的。GitHub が記録する asset digest（現在 `sha256:75d2fa5c…`）と zip 内 `manifest.json`（83 件。`redacted: true`）の sha256 を突き合わせられる（2026-10-12 に一致を確認） | できない（**管理者が差し替え・削除できる**。実際に 2026-10-12 に墨消し済みの版へ差し替え、digest が `sha256:992897dc…` から変わった） | 墨消し済み（evidence-09）。差し替えの記録は [evidence/README.md](evidence/README.md) |
| **署名・provenance**（cosign keyless、SLSA provenance、Rekor） | 永続（透明性ログ。イメージの保持は GHCR の設定に依存し、**保持設定は未確認**） | **できる**（第三者が検証できる）。2026-10-12 に backend・frontend とも `cosign verify`（identity `release.yml@refs/tags/v1.0.0`・OIDC issuer `token.actions.githubusercontent.com`）と `gh attestation verify`（SLSA provenance、`sourceRepositoryDigest` = X）が成功。Rekor の記録時刻は 2026-10-11T15:46:34Z（backend の例） | **できる**（イメージは digest でアドレスされ、内容が変われば digest が変わる。署名は Rekor に残る） | 署名しているのは**イメージ**で、`docs/` の文書・CSV・証跡は署名していない。タグ（`v1.0.0`）は付け替えられるため、参照は **digest** で行う |

**「改変防止された保管先」と言えるもの・言えないもの**

- **言える**: 署名済みイメージ（digest 固定・cosign 署名・SLSA provenance・Rekor）。「このイメージは X のこの run が作った」を第三者が確かめられる。
- **検知はできるが防止とは言えない**: Git 履歴（commit hash）と hash 台帳（manifest）。Ruleset を適用すれば、force push・削除の防止は GitHub 側で強制される（ACT-008）。それでも管理者の bypass（設計は PR 経由のみ）と、リポジトリの削除は残る。
- **言えない**: CI の artifact（90 日で消え、削除可能）、Release の添付（管理者が差し替え可能）。「署名・Git に取り込んだ写し・hash 台帳」を組み合わせて、**どれか 1 つが差し替えられても他と突き合わせて検知できる**状態にしているのであって、防止ではない。

**保存期間の方針**: 証跡は Git に取り込んだ写しを永続とし、CI の artifact は 90 日（原本を失うので、Git への取り込みを欠かさない）、Release の添付は永続（削除されるまで）。**リポジトリ内に、法令・契約による保存期間の要求は見当たらない**（仕様書・SECURITY.md・ADR・CONTRIBUTING・README に記載なし）。要求が出たら見直す。

**hash と取得時刻**

| 項目 | 実態 |
|---|---|
| hash | 成果物台帳 72 / 72（`source_sha256`。現物と一致 72）、manifest 365 / 365、証拠索引 373 / 373、Release の zip 内 manifest 83 / 83、墨消し 5 ファイル（取り込み時）と 11 ファイル（Release の zip。差し替え後）は元と墨消し後の両方 |
| 取得時刻 | manifest の `captured_at` 365 / 365、証拠索引の `captured_at` 373 / 373、各ディレクトリの `SOURCE.json`。原本が Git のものは commit 時刻（台帳の `updated_at` 72 / 72）。**時刻は取得元の記録を使い、独立した時刻証明（タイムスタンプ局）は使っていない**（イメージの署名だけ Rekor が時刻を持つ） |

**人による実効性の確認（上限 3）**: 次の手順を人が実施し、確認者（ロール）・日付・結果を書く。**現在は未実施**。2026-10-12 に AI が行った機械的な検証は、独立した第三者の確認ではない。

| 確認する点 | 手順 | 確認者・確認日 | 結果 |
|---|---|---|---|
| 署名・provenance | 上の `cosign verify`・`gh attestation verify` を別の端末で実行 | 未実施 | — |
| hash 台帳 | `node scripts/evidence/verify-manifest.mjs` を新しい clone で実行 | 未実施 | — |
| Release の添付 | ダウンロードした zip の sha256 が `gh release view` の digest（`75d2fa5c…`）と一致し、zip 内 manifest の全件が一致 | 未実施（AI が 2026-10-12 に再計算して一致を確認したが、人の確認ではない） | — |
| Git の改変防止 | Ruleset の適用後、`gh api repos/bsj-fujimoto/todo-app/rulesets` と `snapshot-github.sh` の出力で、force push 禁止・削除禁止が `active` か確認し、スナップショットを `docs/evidence/github/` に保存 | 未実施（ACT-008） | — |
| 取り込みの正しさ | `gh run download 38152472087 -n <artifact>` で原本を取り、sha256 が証拠索引と一致（artifact は 2027-01-09 まで） | 未実施 | — |

## できていないこと・次の手

| # | できていないこと | 次の手（担当ロール） | 追跡 |
|---|---|---|---|
| 1 | main・タグの Ruleset が未適用。履歴の書換え・タグの付け替えを防止できない | 適用し、スナップショットを `docs/evidence/github/` に保存（プロダクトオーナー。evidence-11） | ACT-008（期限 2026-10-16） |
| 2 | 人による確認が未実施（正本の真正性・抽出の内容 parity・秘密の最終確認・改変防止の実効性） | 各章の確認欄に確認者・日付を記録（QA リード、セキュリティ担当） | 未起票 |
| 3 | ~~成果物台帳が古い・ART-58 の `approved_by` が誤り~~ | **解消**（版 1.1: 再生成して `--strict-artifacts` が PASS。ヘッダ解析を修正）。文書を更新したら再生成を続ける | — |
| 4 | レビュー記録のファイルが無い（review ID の記録先）。~~旧 run の整理~~は印を付けて解消（`superseded_by`）。性能の `SOURCE.json` の `version` も訂正済み | `docs/evidence/reviews/` を作る | 未起票 |
| 5 | 墨消し前の値が Git 履歴に残る（履歴は書き換えない）。~~Release の添付に残る・README の記述が実態と異なる~~は解消（添付は 2026-10-12 に差し替え、README は実態に直した） | 履歴の扱いは方針どおり（force push 禁止）。差し替えた添付の人の確認（evidence-09） | — |
| 6 | 統制の主張（Ruleset 未適用ほか）を裏付けるスナップショットが無い | `snapshot-github.sh` の出力を取り込み、証拠索引に載せる（証跡担当） | ACT-008 に含める |
| 7 | ~~FND-012 の owner・期限が `findings.csv` で空~~ | **解消**（版 1.1: `triage.yaml` に追記して再生成。status は run の時点の untriaged のまま。効果の確認は ACT-010） | ACT-010 |
| 8 | 画面キャプチャが無い（観察値のテキストのみ） | 必要になったら取り込みを拡張（容量との相談） | `docs/evidence/README.md` の既知の制約 |

## 更新規則

| 変更 | 直す箇所 |
|---|---|
| リリース（新しいタグ）を作った | `release.json` → 取り込み（`scripts/evidence/README.md` の手順）→ 本書の evidence-01・02・05・11 の値と review ID の例 |
| Ruleset を適用した | evidence-09・11 の「適用は未」、できていないこと 1、`docs/README.md` 5 章、`ai-context.yaml` の `repository.expected_controls` |
| 人が確認した | 該当章の確認欄（確認者のロール・日付・結果） |
| 台帳・証跡を再生成した | 本書の件数（72・365・373・94）を `check-evidence.mjs` の出力で数え直す |
| 保管先・保存期間を変えた | evidence-11 の表と `artifacts.yaml` の `retention_policy` |

## 付録 確認に使うコマンド

```fish
# 対象版と証跡の一致・改変検知・ID 参照・証拠索引・秘密の簡易検査（リリース SHA を固定した厳格な検査）
node scripts/evidence/check-evidence.mjs --release 5fcf40a7e58dc253e53ff56860d0669a69abda26 --strict
node scripts/evidence/verify-manifest.mjs
node scripts/evidence/check-parity.mjs
node scripts/ci/docs-check.mjs

# 台帳が最新か（失敗するなら npm run evidence:build で再生成）
node scripts/evidence/build-artifacts.mjs --check

# GitHub の実態（read-only）
gh release view v1.0.0 --json assets,publishedAt
gh api repos/bsj-fujimoto/todo-app/rulesets
gh attestation verify oci://ghcr.io/bsj-fujimoto/todo-app-backend@sha256:87addb2e3998f9c793e1c979f9b65d98d3cca98e1eea57be8c6ac28705f5a213 --repo bsj-fujimoto/todo-app
cosign verify ghcr.io/bsj-fujimoto/todo-app-backend@sha256:87addb2e3998f9c793e1c979f9b65d98d3cca98e1eea57be8c6ac28705f5a213 --certificate-identity-regexp '^https://github.com/bsj-fujimoto/todo-app/.github/workflows/release.yml@' --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

`cosign` は mise で入れる（`mise use -g aqua:sigstore/cosign`）。frontend も同じ形で、digest だけ `sha256:c82e88bae5e0aeb7d04df9e31808d1d490cdc6bc01b98efe11db7cd9b526ee9a` にする。

## 変更履歴

| 版 | 日付 | 内容 | 作成 | レビュー | 承認 |
|---|---|---|---|---|---|
| 1.0 | 2026-10-12 | 初版（品質証跡の設計・運用・実態） | QA リード（ロール。実作業は AI エージェント） | QA リード（未実施。第二の目は無い） | プロダクトオーナー（PR #55 のマージ＝承認の代行。オーナーの確認は未実施） |
| 1.1 | 2026-10-12 | 横断整合: 台帳・証拠索引・manifest の再生成と数え直し（72・373・365・追跡表 94 行）、ART-58 の `approved_by` の修正、旧 run の `superseded` 印、security 33 件の版の訂正、Release 添付の差し替えの記録、FND-012 の owner・due、`ai-context.yaml` の C-001 解消 | QA リード（ロール。実作業は AI エージェント） | QA リード（未実施。第二の目は無い） | プロダクトオーナー（PR のマージ＝承認の代行。オーナーの確認は未実施） |
