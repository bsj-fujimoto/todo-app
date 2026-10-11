# todo-app

個人用の最小 ToDo アプリ（frontend / backend 分離・docker compose 構成）。

同時に、QA/QC 成果物（テスト計画〜品質証跡）の **お手本** として、`docs/` 以下に成果物一式を保守する。

- 仕様: [spec/](spec/)
- 成果物（プロダクト単位の正本）: [docs/](docs/)
- フェーズ運用: フェーズ N のプロジェクト単位ドキュメントは `docs/draft/phaseN/` で固め、完了後に `docs/` 直下の正本へ取り込む

開発フローは GitHub Flow（`main` は常にリリース可能。作業は短命ブランチ → PR → レビュー → マージ）。

## 起動（docker compose）

```fish
docker compose up --build
```

<http://localhost:8080> を開く。frontend（nginx）が静的ファイルを配信し、`/api` を backend へ中継する。backend のポートはホストへ公開しない。

- タスクは compose の名前付きボリューム `todo-data`（SQLite）に保存される。`docker compose down` では残り、`docker compose down -v` で失われる。
- 公開ポートの変更: `set -gx FRONTEND_PORT 18080`（既定 8080）。ビルドの commit SHA: `set -gx COMMIT_SHA (git rev-parse HEAD)`（`/api/v1/health` の `commit` に出る）。
- 停止して片付ける: `docker compose down -v`

## 開発・テスト

ツールは mise で固定する（`mise install` → `npm ci`）。

| 目的                                                                                                    | コマンド                                |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| lint / 書式                                                                                             | `npm run lint` / `npm run format:check` |
| frontend の unit（node:test。JUnit は `frontend/test-results/junit.xml`、行カバレッジ 90% 未満で失敗）  | `npm test --workspace frontend`         |
| E2E（compose を除く全 project。結果は `e2e/test-results/junit.xml` と `e2e/playwright-report/`）        | `npm run e2e`                           |
| E2E（docker compose の実環境。専用 project 名 `todoapp-e2e`・空きポートで起動し、`down -v` で片付ける） | `npm run e2e:compose`                   |

E2E の初回はブラウザを入れる: `cd e2e; npx playwright install chromium firefox webkit`。
E2E は各テストが専用の backend プロセス（空きポート・一時 DB）と frontend 配信サーバーを起動するので、並列に実行しても汚染しない（compose だけ直列）。
