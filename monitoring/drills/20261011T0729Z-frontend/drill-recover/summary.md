## 外形監視の実行結果

- 対象: **フォールバック: docker compose up --build（main の HEAD）**
- 版: 1.0.0@552a854（期待: 未指定 / 552a854c1be89363354fd7bf6c56311cf5774c16）
- 実行: 20261011T072931（drill-recover）、UTC 2026-10-11T07:29:31.515Z、環境: local-docker

| monitor | 名前 | 種別 | 結果 | 試行 | 時間 (ms) | 備考 |
|---|---|---|---|---|---|---|
| MON-001 | frontend 配信（GET /） | http | OK | 1 | 7 |  |
| MON-003 | API ジャーニー J-01 追加して一覧に残る（POST → GET → DELETE） | api | OK | 1 | 30 |  |
| MON-007 | ブラウザジャーニー J-01 追加 → 再読込で残る | browser | OK | 1 | 2588 |  |

成功 3 / 3、失敗 0（うち通知抑制 0）、無効 0
