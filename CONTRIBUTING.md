# 開発の進め方

## GitHub Flow

1. `main` は常にリリース可能。直接 push しない（Ruleset で禁止）。
2. 短命ブランチを切る（`feat/…` `fix/…` `docs/…` `chore/…` `spec/…`）。
3. PR を出し、CI を緑にしてからレビュー・マージ（squash）。マージ後ブランチは自動削除。

## テストの規約

- テスト名の先頭にケース ID を付ける（例: `TC-012 100文字ちょうどは追加できる`）。ケースの正本は `docs/data/cases.csv`。
- 時刻・乱数・ID 採番は注入する（`eslint.config.js` の規約。composition root 以外で `Date.now()` などを直接呼ばない）。
- 不具合を見つけたら握りつぶさず `defect` Issue を起票し、修正 PR で回帰テストを追加する。

## 開発環境

ツールは mise で固定（`mise.toml`）。`mise install` → `npm ci`。
