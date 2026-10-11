---
name: 不具合（defect）
about: テスト・運用で見つけた不具合を記録する
labels: defect
---

## 識別

- 検出工程: <!-- unit / api / e2e / regression / manual / review / monitoring / production -->
- 混入工程: <!-- requirements / design / implementation / test / environment -->
- 重大度: <!-- critical / major / minor / trivial -->
- 機能: <!-- add / list / toggle / delete / validation / storage / api / ui / infra -->
- 品質特性: <!-- functional / reliability / usability / security / performance / compatibility -->
- 対象版: <!-- commit SHA / 版 -->
- 上流文書: <!-- 期待結果の根拠（例: spec/todo-phase1-spec.html#F-01、backend/openapi.yaml#/components/schemas/Health、docs/data/cases.csv#TC-xxx） -->

## 再現手順

1.

## 期待結果

<!-- 仕様書・契約の該当箇所（REQ-xxx / AC-xx / openapi.yaml#...） -->

## 実際の結果

## 影響

<!-- 利用者への影響・回避策 -->

## 関連ケース / 証拠

- ケース: <!-- TC-xxx -->
- 証拠: <!-- CI run URL / スクリーンショット / ログ -->

## 原因分類（判明後に記入）

- 根本原因:
- 原因分類: <!-- requirements / design / implementation / review / test / environment / process のどれか 1 つ -->
- 検出可能だった工程: <!-- 語彙は検出工程と同じ。括弧書きで説明を足してよい -->
- 修正 PR: <!-- #番号（修正がマージされたら） -->
