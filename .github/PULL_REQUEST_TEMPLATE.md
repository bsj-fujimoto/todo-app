## 概要

<!-- 何を・なぜ変えるか -->

## 関連

<!-- Issue / 要求 ID（REQ-xxx）/ リスク ID（RISK-xxx）/ ケース ID（TC-xxx） -->

## 変更の種類

- [ ] 機能・修正（実装） - [ ] 仕様変更（spec/） - [ ] テスト - [ ] ドキュメント（docs/） - [ ] CI・セキュリティ設定

## 確認（Definition of Done）

- [ ] 仕様・API 契約（backend/openapi.yaml）と矛盾していない
- [ ] 追加・変更した振る舞いに、ケース ID（TC-xxx）を持つ自動テストがある
- [ ] CI（lint・unit・api・e2e・contract・セキュリティ検査）が緑
- [ ] 影響する成果物（docs/）を更新した（トレーサビリティ ID が解決する）
- [ ] 画面・API の振る舞いを変えた場合、外形監視（monitoring/・e2e/synthetic/）の期待が変わらないか確認した（変わるなら同じ PR で直す。例: PR #12 の「チェックは API 成功後に反転」で MON-008 が誤検知した）
- [ ] 秘密情報・個人情報を含めていない

🤖 Generated with [Claude Code](https://claude.com/claude-code)
