### drill-38154528493（fail）

- 注入した障害: backend コンテナの停止（docker compose stop backend）。復旧は start backend
- 検知（監視が失敗を確認）: 2026-10-11T16:14:10.170Z UTC
- 通知（Issue 作成）: 2026-10-11T16:14:41Z UTC（検知から 31 秒）
- ack: 2026-10-11T16:14:45.386Z UTC（4 秒。方法: assignee-verified（assignee 設定の確認。人が通知を受け取ったかは観測できない））
- 回復の確認: 2026-10-11T16:14:18.732Z UTC（検知から 9 秒）
- 対象の監視: MON-002, MON-003
- Issue: #44（CLOSED）, #45（OPEN）
- 確認項目: issue_created=OK, labels_ok=OK, assignee_verified=OK, recovery_detected=NG, issue_closed=NG
