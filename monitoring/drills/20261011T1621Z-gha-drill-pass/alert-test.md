### drill-38155028980（pass）

- 注入した障害: backend コンテナの停止（docker compose stop backend）。復旧は start backend
- 検知（監視が失敗を確認）: 2026-10-11T16:21:16.141Z UTC
- 通知（Issue 作成）: 2026-10-11T16:21:52Z UTC（検知から 36 秒）
- ack: 2026-10-11T16:21:57.259Z UTC（5 秒。方法: assignee-verified（assignee 設定の確認。人が通知を受け取ったかは観測できない））
- 回復の確認: 2026-10-11T16:21:24.549Z UTC（検知から 8 秒）
- 対象の監視: MON-002, MON-003
- Issue: #48（CLOSED）, #49（CLOSED）
- 確認項目: issue_created=OK, labels_ok=OK, assignee_verified=OK, recovery_detected=OK, issue_closed=OK
