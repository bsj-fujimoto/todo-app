# ADR-0003: Node.js は LTS の 24 系に固定する（奇数 major は採用しない）

- 状態: 採用（2026-10-11）
- 決定者: プロダクトオーナー（リポジトリオーナーの指示。PR #28 のマージをもって承認。フェーズ1は AI が代行マージ）
- 関連: PR #27（Dependabot の node 24-alpine → 25-alpine。Security 検査が失敗してクローズ）、PR #28（Dependabot が奇数 major を提案しないようにする）、`mise.toml`、`.github/dependabot.yml`、`security/dependency-selection.yaml`

## 背景

backend は Node.js 組み込みの `node:sqlite`（同期 API）で SQLite を扱い、ネイティブ拡張のビルドを避けている（`security/dependency-selection.yaml`）。
そのため Node の版が、実行環境（`mise.toml`、`engines`）・ベースイメージ（`node:24-alpine`）・CI・テストの挙動をまとめて決める。

2026-10-11 に Dependabot が backend のベースイメージを `node:24-alpine` から `25-alpine` へ上げる PR #27 を出した。
25 は奇数 major で、LTS（長期サポート）にならない「Current」系のため、保守期間が短い。PR #27 は Security 検査が失敗したのでクローズし、再発を防ぐために PR #28 で設定を直した。

## 決定

- Node.js は **LTS の 24 系**に固定する。`mise.toml` の `node = "24"`、ルートと backend の `package.json` の `engines.node >= 24`、Dockerfile のベースイメージ `node:24-alpine`（tag + digest）を一致させる。
- `.github/dependabot.yml` の docker で、`node` の **奇数 major（25 系・27 系）の提案を除外**する（`ignore` に `>=25.0.0 <26.0.0` と `>=27.0.0 <28.0.0`）。偶数 major（LTS になる系）の提案は受ける。
- 24 系の中の minor・patch は Dependabot（週次）で追従する。

## 影響

- 長期サポートのある版だけを使うので、勧告・修正の追従が途切れにくい。
- 次の限界がある（正直に）。
  - 除外は Dependabot の **docker の `node` だけ**に効く。`mise.toml`・`engines`・Dockerfile を人が手で 25 系にすれば止まらない。一致は `mise.toml` と Dockerfile のレビュー（CODEOWNERS）に頼っている。
  - 偶数 major の 26 は提案されうる。**26 へ上げるかは LTS になってからの別判断**とし、そのときは `mise.toml`・`engines`・Dockerfile・CI を同じ PR で変え、永続化（`backend/test/api/persistence`）・性能（TC-073・TC-074 と `perf/`）の回帰を確かめる。
  - `node:sqlite` は Node の更新で挙動が変わりうるので、版を上げる PR では永続化テストの全件を回す（`quality/impact-map.yaml` の依存ファイル変更は全件実行）。
- 検査への影響: ベースイメージの更新は trivy image が脆弱性を検査する。zlib の CVE-2026-85091 は期限付き受容（Issue #22、2027-01-09）で、イメージの digest 更新で消える見込み。

## 却下した案

| 案 | 却下の理由 |
|---|---|
| 最新の Node（25 系）に追従する | 奇数 major は LTS にならず、保守期間が短い。実際に PR #27 は Security 検査が失敗した |
| 版を固定せず `node:latest` / `lts-alpine` にする | 再現性が無くなる。tag + digest で固定する方針（ADR-0002）に反する |
| Dependabot の docker 更新を止める | ベースイメージの脆弱性修正を取り込めなくなる。奇数 major だけを除外すれば足りる |
