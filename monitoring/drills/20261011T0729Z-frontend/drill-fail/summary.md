## 外形監視の実行結果

- 対象: **フォールバック: docker compose up --build（main の HEAD）**
- 版: 不明（期待: 未指定 / 552a854c1be89363354fd7bf6c56311cf5774c16）
- 実行: 20261011T072918（drill-fail）、UTC 2026-10-11T07:29:18.018Z、環境: local-docker

| monitor | 名前 | 種別 | 結果 | 試行 | 時間 (ms) | 備考 |
|---|---|---|---|---|---|---|
| MON-001 | frontend 配信（GET /） | http | FAIL | 3 | 2 | 試行 1: 通信エラー: fetch failed（ECONNREFUSED） \| 試行 2: 通信エラー: fetch failed（ECONNREFUSED） \| 試行 3: 通信エラー: fetch failed（ECONNREFUSED） |
| MON-003 | API ジャーニー J-01 追加して一覧に残る（POST → GET → DELETE） | api | FAIL | 2 | 3 | 試行 1: 通信エラー: fetch failed（ECONNREFUSED） \| 試行 2: 通信エラー: fetch failed（ECONNREFUSED） |
| MON-007 | ブラウザジャーニー J-01 追加 → 再読込で残る | browser | FAIL | 2 | 2087 | 試行 1: [MON-007] J-01 追加すると一覧に出て、再読込しても残る: Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/ \| 試行 2: [MON-007] J-01 追加すると一覧に出て、再読込しても残る: Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/ |

成功 0 / 3、失敗 3（うち通知抑制 0）、無効 0
