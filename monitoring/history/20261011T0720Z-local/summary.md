## 外形監視の実行結果

- 対象: **フォールバック: docker compose up --build（main の HEAD）**
- 版: 1.0.0@552a854（期待: 未指定 / 552a854c1be89363354fd7bf6c56311cf5774c16）
- 実行: 20261011T072052（normal）、UTC 2026-10-11T07:20:52.311Z、環境: local-docker

| monitor | 名前 | 種別 | 結果 | 試行 | 時間 (ms) | 備考 |
|---|---|---|---|---|---|---|
| MON-001 | frontend 配信（GET /） | http | OK | 1 | 4 |  |
| MON-002 | backend health とデプロイマーカー（GET /api/v1/health） | http | OK | 1 | 3 |  |
| MON-003 | API ジャーニー J-01 追加して一覧に残る（POST → GET → DELETE） | api | OK | 1 | 14 |  |
| MON-004 | API ジャーニー J-02 完了切替（POST → PATCH → GET → PATCH → DELETE） | api | OK | 1 | 11 |  |
| MON-005 | API ジャーニー J-03 削除（POST → DELETE → GET → DELETE） | api | OK | 1 | 7 |  |
| MON-006 | API ジャーニー J-04 不正入力が弾かれる（空・101 文字・改行・不正本文） | api | OK | 1 | 6 |  |
| MON-007 | ブラウザジャーニー J-01 追加 → 再読込で残る | browser | OK | 1 | 2536 |  |
| MON-008 | ブラウザジャーニー J-02 完了切替（チェック → 再読込で保持） | browser | OK | 1 | 1241 |  |
| MON-009 | ブラウザジャーニー J-03 削除（削除ボタン → 再読込でも消えたまま） | browser | OK | 1 | 1146 |  |
| MON-010 | ブラウザジャーニー J-04 不正入力が弾かれる（空入力 → エラー表示・件数不変） | browser | OK | 1 | 913 |  |
| MON-011 | TLS 証明書の期限（無効: 本番ドメインと実証明書が無い） | tls | SKIP | - | - | 無効: 本リポジトリに本番環境・ドメイン・実証明書が無い。runner 内の localhost は HTTP のみ（TLS 終端を compose に追加しない前提）で、 証明書の期限は検証できない。本番（独自ドメインと TLS 終端）を持つ場合に有効化する。 |
| MON-012 | DNS 解決（無効: 本番ドメインが無い） | dns | SKIP | - | - | 無効: 本リポジトリに本番ドメインが無い。runner 内は compose のサービス名と localhost で、実 DNS の解決・伝播は検証できない。 本番を持つ場合に A/AAAA/CNAME の解決先と TTL を期待値と照合する監視として有効化する。 |

成功 10 / 10、失敗 0（うち通知抑制 0）、無効 2
