### drill-20261011T072645（pass）

- 注入した障害: backend コンテナの停止（docker compose stop backend）。復旧は start backend
- 検知（監視が失敗を確認）: 2026-10-11T07:26:45.535Z UTC
- 通知（Issue 作成）: 2026-10-11T07:27:03Z UTC（検知から 17 秒）
- ack: 2026-10-11T07:27:13.253Z UTC（10 秒。方法: assignee-verified（assignee 設定の確認。人が通知を受け取ったかは観測できない））
- 回復の確認: 2026-10-11T07:27:16.900Z UTC（検知から 31 秒）
- 対象の監視: MON-002, MON-003
- Issue: #17（CLOSED）, #18（CLOSED）
- 確認項目: issue_created=OK, labels_ok=OK, assignee_verified=OK, recovery_detected=OK, issue_closed=OK
