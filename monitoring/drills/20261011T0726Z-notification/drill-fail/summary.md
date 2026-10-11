## 外形監視の実行結果

- 対象: **フォールバック: docker compose up --build（main の HEAD）**
- 版: 不明（期待: 未指定 / 552a854c1be89363354fd7bf6c56311cf5774c16）
- 実行: 20261011T072645（drill-fail）、UTC 2026-10-11T07:26:45.287Z、環境: local-docker

| monitor | 名前 | 種別 | 結果 | 試行 | 時間 (ms) | 備考 |
|---|---|---|---|---|---|---|
| MON-002 | backend health とデプロイマーカー（GET /api/v1/health） | http | FAIL | 3 | 7 | 試行 1: status が 502（期待 200）; 本文が JSON でなく Health を検証できない; 本文が JSON でない \| 試行 2: status が 502（期待 200）; 本文が JSON でなく Health を検証できない; 本文が JSON でない \| 試行 3: status が 502（期待 200）; 本文が JSON でなく Health を検証できない; 本文が JSON でない |
| MON-003 | API ジャーニー J-01 追加して一覧に残る（POST → GET → DELETE） | api | FAIL | 2 | 7 | 試行 1: step create: status が 502（期待 201）; 本文が JSON でなく Task を検証できない; 本文が JSON でない \| 試行 2: step create: status が 502（期待 201）; 本文が JSON でなく Task を検証できない; 本文が JSON でない |

成功 0 / 2、失敗 2（うち通知抑制 0）、無効 0
