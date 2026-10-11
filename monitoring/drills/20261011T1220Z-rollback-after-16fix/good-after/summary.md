## 外形監視の実行結果

- 対象: **フォールバック: docker compose up --build（main の HEAD）**
- 版: 1.0.0@08df5b7（期待: 未指定 / 08df5b7da03f543add68aafcfd7f4d3024a8432e）
- 実行: 20261011T122111（normal）、UTC 2026-10-11T12:21:11.330Z、環境: local-docker

| monitor | 名前 | 種別 | 結果 | 試行 | 時間 (ms) | 備考 |
|---|---|---|---|---|---|---|
| MON-001 | frontend 配信（GET /） | http | OK | 1 | 4 |  |
| MON-002 | backend health とデプロイマーカー（GET /api/v1/health） | http | OK | 1 | 2 |  |
| MON-003 | API ジャーニー J-01 追加して一覧に残る（POST → GET → DELETE） | api | OK | 1 | 13 |  |
| MON-004 | API ジャーニー J-02 完了切替（POST → PATCH → GET → PATCH → DELETE） | api | OK | 1 | 10 |  |
| MON-005 | API ジャーニー J-03 削除（POST → DELETE → GET → DELETE） | api | OK | 1 | 6 |  |
| MON-006 | API ジャーニー J-04 不正入力が弾かれる（空・101 文字・改行・不正本文） | api | OK | 1 | 5 |  |

成功 6 / 6、失敗 0（うち通知抑制 0）、無効 0
