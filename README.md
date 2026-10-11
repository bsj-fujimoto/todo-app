# todo-app

個人用の最小 ToDo アプリ（frontend / backend 分離・docker compose 構成）。

同時に、QA/QC 成果物（テスト計画〜品質証跡）の **お手本** として、`docs/` 以下に成果物一式を保守する。

- 仕様: [spec/](spec/)
- 成果物（プロダクト単位の正本）: [docs/](docs/)
- フェーズ運用: フェーズ N のプロジェクト単位ドキュメントは `docs/draft/phaseN/` で固め、完了後に `docs/` 直下の正本へ取り込む

開発フローは GitHub Flow（`main` は常にリリース可能。作業は短命ブランチ → PR → レビュー → マージ）。
