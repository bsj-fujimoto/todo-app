---
name: 障害・アラート（incident）
about: 外形監視のアラート、または運用で気づいた障害
labels: incident
---

<!-- incident を調べた結果、欠陥（defect）として扱う内容だった場合は、本文を書き換えずに、このテンプレートの項目（再発防止のチェックリスト・deployment_ref・ack 欄）を残したまま、末尾に defect.md の項目を「追記」する（monitoring/README.md「incident と defect を兼ねる Issue の書式」）。 -->
<!-- 外形監視（monitoring/）のアラートは scripts/monitoring/alert.mjs がこの書式で自動起票する。手で起票するときも同じ項目を埋める。 -->
<!-- 直前のデプロイ（deployment_ref）は実際のデプロイマーカーから書く。取れなければ「取れない: 理由」（「不明」と書かない）。close するとき monitoring/incidents.csv に 1 行足す（真因が入った変更を直前のデプロイと区別して書く）。 -->

## 概要

- 開始時刻（UTC）:
- 検知方法: <!-- monitoring / user report / test -->
- 重大度: <!-- sev1 / sev2 / sev3（定義は monitoring/alert-routes.yaml） -->
- 影響:
- 監視 ID / ジャーニー: <!-- MON-xxx / J-xx（手で起票する場合は空でよい） -->
- 直前のデプロイ（deployment_ref）: <!-- version / commit / release タグ。scripts/monitoring/marker.mjs が記録する health の版 -->

## 対応

- 担当（on-call ロール = maintainer）:
- ack（Issue へのコメント、または assignee の確認。目標 24 時間以内）:
- 一次対応（runbook: monitoring/runbooks/RB-xxx）:
- 切り分け:
- ロールバック有無: <!-- あれば戻した先のイメージ digest -->
- 回復時刻（UTC）:

## 再発防止（還流先）

<!-- チェックしたら、右の「記録」に ID・パスを書く。close する前に全項目を「実施」か「不要（理由）」にする。 -->
- [ ] defect 起票 — 記録: <!-- #123 -->
- [ ] テスト追加（TC-xxx） — 記録: <!-- docs/data/cases.csv の TC-xxx、または e2e/synthetic の MON-xxx -->
- [ ] 監視の追加・調整（monitoring/monitors.yaml） — 記録: <!-- PR 番号。誤検知・見逃しなら monitoring/fp-fn-log.md にも追記 -->
- [ ] runbook 更新（monitoring/runbooks/） — 記録: <!-- PR 番号。runbook の「訓練記録」にも反映 -->

## 振り返り（close 時に記入）

- 原因（根本原因・混入工程）:
- 検出できた工程 / 早く検知できたか:
- 監視は期待どおり鳴ったか（誤検知・見逃し）:
- 同種の障害が再発していないか: <!-- 過去の incident Issue へのリンク -->
