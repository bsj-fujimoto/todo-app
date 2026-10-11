# security/ — セキュリティ検査の方針と台帳

検査の実体は `.github/workflows/security.yml`（PR・main push・週次・手動・release から再利用）。
マージの可否は集約ジョブ **`security-result`** だけが決める（Ruleset の required check）。

## 検査の一覧

| 検査          | ツール（版は `tools.env` で digest 固定）                              | 設定ファイル                                        | 出力（artifact に 90 日保存）                      | 失敗の条件                                           |
| ------------- | ---------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| SAST          | CodeQL（javascript-typescript、security-extended）                     | `codeql-config.yml`                                 | SARIF（Code Scanning にもアップロード）            | triage のゲート                                      |
| Secret        | gitleaks（git 履歴全体）                                               | `gitleaks.toml`                                     | SARIF（値は伏字）                                  | triage のゲート。履歴を 1 commit も読めなければ失敗  |
| SCA           | npm audit（`--omit=dev` と全体）、osv-scanner                          | —                                                   | JSON / SARIF                                       | triage のゲート                                      |
| SBOM          | `@cyclonedx/cyclonedx-npm`、trivy（イメージ）                          | —                                                   | CycloneDX 1.6 JSON（実行時依存 / 全体 / イメージ） | 生成できなければ失敗                                 |
| Container/IaC | trivy（fs: vuln,misconfig,secret / image ×2）、hadolint、compose-check | `hadolint.yaml`、`scripts/security/lib/compose.mjs` | JSON / SARIF                                       | triage のゲート                                      |
| License       | license-checker-rseidelsohn + 自前の方針評価                           | `license-policy.yaml`                               | JSON                                               | 許可リスト外が 1 つでもあれば失敗（deny by default） |
| DAST          | OWASP ZAP（baseline + API 走査。認証なし）                             | `zap-rules.tsv`                                     | JSON / SARIF / HTML / Markdown                     | triage のゲート                                      |
| ワークフロー  | actionlint、`check-workflows.mjs`（W1〜W10）                           | `workflow-policy.yaml`                              | JSON                                               | 逸脱があれば失敗                                     |
| 依存レビュー  | actions/dependency-review-action（PR のみ）                            | `security.yml` の `allow-licenses`（方針の写し）    | PR の依存差分                                      | high 以上・方針外ライセンス                          |
| Scorecard     | OpenSSF Scorecard（週次のみ）                                          | —                                                   | SARIF                                              | 情報提供のみ（ゲートに含めない）                     |

どの検査も `scripts/security/scan.sh <検査名>` で **CI とローカルが同じコマンド**を実行する（再現できる）。出力は `security-results/<検査名>/` に置かれ、
検査ごとに `scan-run.json`（対象リポジトリ・branch・commit SHA・イメージ digest・実行日時・ツール名と版・コマンド・設定ファイル・走査範囲と除外・しきい値・出力ファイルの sha256）を残す。
SARIF には同じ情報（`versionControlProvenance`・`invocations`）を追記するので、SARIF 単体でも「何を・いつ・どのコマンドで」検査したかが追える。

- イメージ digest: CI の検査はビルド直後のローカルイメージ ID（config digest）を記録する。レジストリの digest は release.yml が push 後に固定・記録する。
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
- `fixed` は「前回の `findings.json`（main の直近の成功 run）にあって、今回は検出されない」ことで機械が付ける。再検査して消えたことが根拠。

### 再検査の条件

- 修正の PR は、その PR の security.yml の再実行で検出が消えること（`fixed`）をもって完了とする。
- `fp` / `na` / `accepted` の検出は、台帳の `reverify_condition`（例: 依存の更新時・期限の 7 日前・該当コードの変更時）で見直す。
- 週次の run（月曜）が、台帳と実際の検出のずれ（`stale_ledger_entries`）を出す。解消した検出の台帳エントリは外す。

## 台帳・方針ファイル

| ファイル                    | 内容                                                                            |
| --------------------------- | ------------------------------------------------------------------------------- |
| `triage.yaml`               | 検出ごとの判断・文脈・是正案（人が書く）                                        |
| `accepted-risks.yaml`       | 期限付き受容（id・理由・owner・受容日・期限・再検査条件）                       |
| `zap-rules.tsv`             | ZAP のしきい値と除外（IGNORE は理由・owner・期限が必須。`check-policy` が検査） |
| `license-policy.yaml`       | 許可・禁止ライセンス、期限付きの例外                                            |
| `workflow-policy.yaml`      | ワークフローの write 権限・OIDC を許してよいジョブの許可リスト                  |
| `expected-scans.yaml`       | 走るべき検査の一覧（欠けたら失敗）                                              |
| `dependency-selection.yaml` | 直接依存の選定理由・検討した代替・保守状況・扱い（180 日ごとに見直す）          |
| `tools.env`                 | 検査ツールのイメージ（tag + digest）                                            |

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
bash scripts/security/scan.sh workflows     # ワークフロー統制 + 方針ファイル
node scripts/security/triage.mjs --results security-results --out security-findings   # トリアージ
```

## ツールの更新

`tools.env` の IMAGE と VERSION を、`docker buildx imagetools inspect <image>:<tag>` で確認した digest ごと書き換える（レビュー対象）。
GitHub Actions の action は Dependabot（github-actions）が SHA 固定のまま更新を提案する。
