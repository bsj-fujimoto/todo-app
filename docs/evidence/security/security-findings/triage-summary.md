### セキュリティ検査のトリアージ

- 対象: `https://github.com/bsj-fujimoto/todo-app` v1.0.0 `5fcf40a7e58dc253e53ff56860d0669a69abda26`
- 検出 12 件（重複排除後）: critical 0 / high 0 / medium 5 / low 2 / info 5
- ステータス: accepted 4 / na 6 / untriaged 1 / tp 1
- 前回比: 新規 0 / 継続 12 / 解消 0（前回: https://github.com/bsj-fujimoto/todo-app/actions/runs/38152163102）
- ゲート: **pass**（critical/high の未解決 0 件）
- medium の未解決 1 件（Issue 化して accepted-risks.yaml で期限付き受容、または修正）
- 安定 ID が未登録の検出 3 件（FND-NEW-…）。node scripts/security/assign-finding-ids.mjs で ID を振って commit する
