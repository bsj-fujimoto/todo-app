# ADR-0001: frontend / backend を分離し、保存先を backend（SQLite）にする

- 状態: 採用（2026-10-11）
- 決定者: プロダクトオーナー（リポジトリオーナーの指示。セッション内で口頭承認）
- 関連: 仕様変更 CR-01 / spec/todo-phase1-spec.html v1.1

## 背景

フェーズ1仕様 v1.0 は「ブラウザ内保存（localStorage の `todo.tasks`）」の1画面アプリだった。
本リポジトリは QA/QC 成果物のお手本でもあるため、実務に近い構成（API・永続化・コンテナ・負荷・外形監視）を
持つ最小の ToDo アプリとして作り直す要望があった。

## 決定

- frontend（静的 HTML/JS、nginx 配信）と backend（Node.js + Fastify、SQLite 永続化）を分離し、`docker compose` で起動する。
- 保存先を localStorage から backend の REST API（`/api/v1/tasks`）に変更する。
- 画面仕様・入力規則・エラー文言・受け入れ条件（AC-01〜AC-07）の**観察可能な挙動は変えない**。
- 仕様書は v1.0 → v1.1 とし、変更履歴に CR-01 を記録する。v1.0 は git 履歴（初期コミット）に残る。

## 影響

| 項目 | v1.0 | v1.1 |
|---|---|---|
| 保存先 | localStorage `todo.tasks` | backend API → SQLite（compose ボリューム `todo-data`） |
| 「保存失敗」 | localStorage 書込み例外 | API のエラー応答・通信失敗 |
| 「保存データ破損」 | JSON 不正 | API が `DATA_CORRUPT`（HTTP 500）を返す |
| データ消失条件 | サイトデータ削除 | ボリューム削除 |
| 対象外 | サーバー保存・端末間同期 | 認証・認可、複数端末同時編集の競合解決 |

テスト対象が増える（API 試験・コンテナ検査・負荷試験・外形監視）。フェーズ2の保存先に関する記述は
フェーズ2仕様書に読み替え注記を入れ、具体化は `docs/draft/phase2` で行う。

## 却下した案

| 案 | 却下の理由 |
|---|---|
| localStorage のまま frontend だけ Docker 化 | backend が存在せず、分離構成の要望を満たさない |
| backend を持つが localStorage も併用 | 正本が2つになり、整合性の問題を持ち込む |
