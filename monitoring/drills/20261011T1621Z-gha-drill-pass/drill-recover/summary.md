## 外形監視の実行結果

- 対象: **リリース済みイメージ（digest 固定）**
- 版: 1.0.0@5fcf40a（期待: 1.0.0 / 5fcf40a7e58dc253e53ff56860d0669a69abda26）
- 実行: 38155028980（drill-recover）、UTC 2026-10-11T16:21:24.549Z、環境: github-hosted-runner

| monitor | 名前 | 種別 | 結果 | 試行 | 時間 (ms) | 備考 |
|---|---|---|---|---|---|---|
| MON-002 | backend health とデプロイマーカー（GET /api/v1/health） | http | OK | 1 | 7 |  |
| MON-003 | API ジャーニー J-01 追加して一覧に残る（POST → GET → DELETE） | api | OK | 1 | 29 |  |

成功 2 / 2、失敗 0（うち通知抑制 0）、無効 0
