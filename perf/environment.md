# 測定環境の記録

性能試験の測定環境、本番（想定）や GitHub-hosted runner との差、測定の揺れの要因を記録する。**値は run ごとに `perf/results/<run_id>/run.json` に自動で記録される**（`scripts/perf/env.mjs`）。
本書はその人が読む説明で、機械可読の差異は [`environment.yaml`](environment.yaml)。

## 今回の測定環境（開発機 / 実測 run: [`results/`](results/) の `<run_id>` は本書末尾の表）

| 項目 | 値 |
| --- | --- |
| 区分（`env_class`） | `local:darwin-arm64`（baseline はこの区分の run とだけ比べる） |
| 機種・CPU | Apple M5 Pro、15 コア（性能コア 5 + 効率コア 10 として OS が報告）。コンテナの CPU 性能はどのコアに載るかで揺れる |
| ホストのメモリ | 48 GiB |
| OS | macOS 27.0.1（Darwin 27.0.0）、arm64 |
| Docker | Docker Desktop（Engine 29.8.2、Compose v5.5.1）。Linux VM（kernel 7.0.14-linuxkit、aarch64）上でコンテナが動く |
| Docker VM の資源 | 15 vCPU、7.75 GiB メモリ（Docker Desktop の設定） |
| 被試験コンテナの上限（`perf/compose.perf.yml`） | backend: 1.0 CPU・512 MiB、frontend（nginx）: 0.5 CPU・128 MiB |
| 負荷生成 | k6 v2.3.0（`grafana/k6@sha256:e66db15b…`、digest 固定）。同じ Docker VM の別コンテナ（上限なし） |
| 画面計測 | Playwright 1.64.0 + Lighthouse 13.5.0 + Chromium（`mcr.microsoft.com/playwright:v1.64.0-noble`、digest 固定）。同じ VM の別コンテナ |
| backend / frontend のイメージ | `node:24-alpine@sha256:ebfe2f90…`（backend、`node:sqlite` の同期 API）、`nginxinc/nginx-unprivileged:stable-alpine@sha256:15c994d1…`（frontend） |
| 判定・観測の実行 | Node 24（mise）。観測サンプラーはホスト上で `docker stats` / `docker exec` を 1 秒ごとに呼ぶ |
| 被試験の構成 | `docker-compose.yml`（frontend:8080 → /api を backend:3000 へ中継）+ `perf/compose.perf.yml` |
| ネットワーク | k6 は compose の内部ネットワークから `http://frontend:8080` を叩く（ホストのポート転送を通らない）。観測の health だけホスト経由（`localhost:8080`） |
| TLS | なし（HTTP）。実際の通信経路にある TLS 終端のコストは含まれない |

## 本番との差異（本番は無い。想定本番との比較）

想定本番: 個人が使う小さな VM（1 vCPU・1 GiB・SSD・docker compose・TLS 終端は別）。**実在する本番は無い**。

| 差異 | 外挿への影響 |
| --- | --- |
| CPU の速さ（Apple M5 の高性能コア vs 一般的なクラウド VM の vCPU） | CPU 律速（Node の単一スレッドが 100% に張り付く）の限界点は、本番では**低く**なる可能性が高い。絶対値（req/s の限界）は過大に出ている。倍率は未測定 |
| CPU 上限の与え方（cgroup の `cpus: 1.0`） | 実 VM の 1 vCPU と同じではない（共有コア・バースト・ノイジーネイバー）。上限は揃えたが速度は揃っていない |
| ファイル I/O（Docker Desktop の VM 内ボリューム。SQLite のファイル） | Linux ネイティブより遅い可能性もあれば、ホスト SSD より速い（VM のキャッシュ）可能性もある。書込み（fsync）の遅延は本番ディスクで変わる。SQLite の journal_mode=DELETE（既定）のため書込みごとに fsync があり、ディスク依存が大きい |
| 負荷生成と被試験が同じホスト | k6 とブラウザ計測が同じ VM の CPU・メモリを使う。k6 の CPU は観測サンプラーで記録し（`k6` の cpu）、被試験が律速か負荷側が律速かを確かめる |
| 外部ネットワークなし | 実ネットワークの遅延・帯域・TLS ハンドシェイクが無い。本番の体感はこれらの分だけ遅くなる（表示完了も同様） |
| データの分布 | 連番の短いタイトル（11 文字前後）。実利用の長いタイトルではレスポンスが大きくなる（一覧の転送量・JSON の生成が増える） |
| 利用者数 | 1 人の操作を、安全率 40 の到着率で再現。複数の利用者・端末の同時利用は対象外（1 人用） |

## GitHub-hosted runner との差

`perf.yml` は GitHub-hosted runner（`ubuntu-24.04`、公開リポジトリの標準 runner: 4 vCPU・16 GiB・Linux ネイティブの Docker）で動く。開発機とは**性能特性が異なり、同じ値にならない**。

| 項目 | 開発機（今回） | GitHub-hosted runner |
| --- | --- | --- |
| OS / Docker | macOS + Docker Desktop（Linux VM） | Ubuntu 24.04 + ネイティブ Docker（VM なし） |
| CPU | Apple M5 Pro（Arm）15 コア（VM に 15 vCPU） | x86_64 の汎用 vCPU（4）。世代・共有の度合いは run ごとに変わりうる |
| メモリ | VM 7.75 GiB | 16 GiB |
| 負荷の同居 | k6 と被試験が同じ VM | k6 と被試験が同じ 4 vCPU を共有（k6 の負荷生成が被試験の CPU を奪いやすい。上限 `cpus` で被試験の取り分は固定） |
| 揺れ | 手元の他プロセス・電源・熱の影響 | 他のジョブ（同じホストの隣人）の影響。run ごとに揺れる |

- baseline は**環境の区分（`env_class`）が同じ run 同士**でだけ比べる（`compare.mjs`）。runner の区分は `github-hosted:<ImageOS>:<RUNNER_ARCH>`。
- **runner での実測は今回できていない**（`perf.yml` は main にマージされるまで Actions から実行できない）。runner の baseline は、初回の `perf.yml` 実行結果を `--update-baseline` で追記して作る。
- runner の CPU・メモリ・ランナーイメージの版は、実行のたびに `perf.yml` が step summary と `run.json`（`runner`、`host`）に記録する。

## 測定の揺れの要因（読み方）

- 3 反復の標準偏差・95% 信頼区間を `variance_stats`（`verdict.json`・`perf-runs.json`）に出す。n = 3 の信頼区間は広い（t 分布の臨界値 4.30）。**数 ms の差は有意と見なさない**（`compare.mjs` は `min_abs_delta` で除く）。
- 毎反復で DB ボリュームを作り直し、warm-up 30 秒の後に計測する。JIT・接続・ページキャッシュが温まった後の値で、**コールドスタート直後の遅さは測っていない**。
- 開発機では、計測中に他のアプリ・他の作業（ビルド等）が走ると揺れる。今回の run 中は、可能な限り他の Docker 作業を止めたが、OS の他プロセスの影響は排除できていない。
- 観測の `docker stats --no-stream` は 1 回に約 1 秒かかるため、tick を重ねて 1 秒間隔を保っている。サンプル間隔は窓内のサンプル数（`time_alignment`）で確認できる。

## 再現手順

```sh
mise x -- npm ci
scripts/perf/run.sh --profile full        # 全シナリオ・3 反復。run_id は UTC 日時-commit SHA7桁
```

同じ commit・同じ設定であることは、`run.json` の `commit_sha`・`script_sha256`・`config_sha256` で確かめる。`manifest.json` に全ファイルの sha256（生ログ含む）がある。
