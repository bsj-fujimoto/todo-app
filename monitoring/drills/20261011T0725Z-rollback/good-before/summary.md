## 外形監視の実行結果

- 対象: **フォールバック: docker compose up --build（main の HEAD）**
- 版: 1.0.0@552a854（期待: 未指定 / 552a854c1be89363354fd7bf6c56311cf5774c16）
- 実行: 20261011T072529（normal）、UTC 2026-10-11T07:25:29.848Z、環境: local-docker

| monitor | 名前 | 種別 | 結果 | 試行 | 時間 (ms) | 備考 |
|---|---|---|---|---|---|---|
| MON-001 | frontend 配信（GET /） | http | OK | 1 | 40 |  |
| MON-002 | backend health とデプロイマーカー（GET /api/v1/health） | http | OK | 1 | 18 |  |
| MON-003 | API ジャーニー J-01 追加して一覧に残る（POST → GET → DELETE） | api | OK | 1 | 192 |  |
| MON-004 | API ジャーニー J-02 完了切替（POST → PATCH → GET → PATCH → DELETE） | api | OK | 1 | 58 |  |
| MON-005 | API ジャーニー J-03 削除（POST → DELETE → GET → DELETE） | api | OK | 1 | 170 |  |
| MON-006 | API ジャーニー J-04 不正入力が弾かれる（空・101 文字・改行・不正本文） | api | OK | 1 | 52 |  |

成功 6 / 6、失敗 0（うち通知抑制 0）、無効 0
