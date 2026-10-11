// 不具合表の生成: Issue 本文のパース・語彙の統一・欠落の検出・状態・修正 commit・リリース。合成の Issue で確かめる。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createReport } from "../lib/common.mjs";
import {
  buildDefect,
  checkDefectRows,
  defectId,
  extractFields,
  releaseFor,
  selectIssues,
  statusOf,
} from "../lib/defects.mjs";
import { oneLine, parseBullets, parseSections } from "../lib/issue-body.mjs";
import { buildSnapshot, fixPrNumbers, sameContent } from "../lib/github-snapshot.mjs";

const BODY = `## 識別

- 検出工程: e2e
- 混入工程: implementation（frontend の実装）。テスト側の問題ではない
- 重大度: major
- 機能: add
- 品質特性: reliability（運用性）
- 対象版: main abc1234
- 上流文書: spec/todo-phase1-spec.html#F-01

## 再現手順

1. 画面を開く。
2. 追加を押す。

## 期待結果

- 入力欄が空になる。

## 実際の結果

入力欄が消えない。

## 影響

<!-- 利用者への影響 -->
入力が残る。

## 関連ケース / 証拠

- ケース: TC-061（検出）、TC-063（UNK-004）
- 証拠: CI の失敗ログ

## 原因分類（判明後に記入）

- 根本原因: app.js が無条件で消す
- 原因分類: implementation
- 検出可能だった工程: implementation / test（応答保留中の入力を見るテスト）
- 修正 PR: #9
`;

const issue = (over = {}) => ({
  number: 6,
  title: "defect: x",
  state: "CLOSED",
  stateReason: "COMPLETED",
  labels: [{ name: "defect" }],
  createdAt: "2026-10-11T06:42:19Z",
  closedAt: "2026-10-11T06:58:31Z",
  body: BODY,
  comments: [],
  ...over,
});

const ctx = (over = {}) => ({
  releases: [],
  fixCommits: new Map([["9", "c".repeat(40)]]),
  caseIds: new Set(["TC-061", "TC-063"]),
  evidence: () => ["EV-0001"],
  ...over,
});

describe("Issue 本文のパース", () => {
  it("見出し（括弧書きは除く）ごとの本文と、箇条書きの キー: 値 を読む。HTML コメントは捨てる", () => {
    const sections = parseSections(BODY);
    assert.deepEqual(
      [...sections.keys()],
      ["識別", "再現手順", "期待結果", "実際の結果", "影響", "関連ケース / 証拠", "原因分類"],
    );
    assert.equal(parseBullets(sections.get("識別")).get("重大度"), "major");
    assert.equal(oneLine(sections.get("影響")), "入力が残る。");
  });

  it("語彙を統一する（括弧書き・複数語・manual など）", () => {
    const f = extractFields(issue());
    assert.deepEqual(
      [
        f.severity,
        f.function,
        f.quality_attr,
        f.injected_phase,
        f.detected_phase,
        f.could_detect_at,
        f.cause_class,
        f.fix_pr,
      ],
      ["major", "add", "reliability", "implementation", "e2e", "test", "implementation", "9"],
    );
    assert.deepEqual(f.case_ids, ["TC-061", "TC-063"]);
    assert.equal(f.repro, "1. 画面を開く。 / 2. 追加を押す。");
    const manual = extractFields(issue({ body: BODY.replace("- 検出工程: e2e", "- 検出工程: manual") }));
    assert.equal(manual.detected_phase, "test");
  });
});

describe("不具合表の行", () => {
  it("全項目が揃った Issue は、語彙どおりの行になる（fixed・fix_commit・release・source）", () => {
    const { row, problems } = buildDefect(issue(), ctx());
    assert.deepEqual(problems, []);
    assert.equal(row.defect_id, "DEF-006");
    assert.deepEqual(
      [row.status, row.fix_commit, row.release, row.source, row.evidence_ids],
      ["fixed", "c".repeat(40), "pre-1.0.0", "test", "EV-0001"],
    );
    assert.equal(row.case_ids, "TC-061;TC-063");
    const report = createReport();
    checkDefectRows([row], report);
    assert.deepEqual(report.errors, []);
  });

  it("欠けている項目・解決しない参照は、Issue 番号つきで指摘する（補筆を促す）", () => {
    const body = BODY.replace("- 原因分類: implementation\n", "")
      .replace("- 修正 PR: #9\n", "")
      .replace("- ケース: TC-061（検出）、TC-063（UNK-004）", "- ケース: TC-999");
    const { problems } = buildDefect(issue({ body }), ctx());
    const text = problems.join("\n");
    assert.match(text, /#6: cause_class が Issue 本文に無い/);
    assert.match(text, /#6: 関連ケース TC-999 が cases.csv に無い/);
    assert.match(text, /#6: closed だが修正 PR の記録が無い/);
  });

  it("状態: open / fixed / closed / wontfix。未マージの修正 PR は指摘する", () => {
    assert.equal(statusOf(issue({ state: "OPEN" }), null), "open");
    assert.equal(statusOf(issue(), "9"), "fixed");
    assert.equal(statusOf(issue(), null), "closed");
    assert.equal(statusOf(issue({ stateReason: "NOT_PLANNED" }), null), "wontfix");
    assert.match(
      buildDefect(issue(), ctx({ fixCommits: new Map() })).problems.join("\n"),
      /修正 PR #9 のマージ commit を取得できない/,
    );
  });

  it("起票日以前で最新のリリースを検出時点の版にする（無ければ pre-1.0.0）", () => {
    const releases = [
      { tag: "v1.0.0", date: "2026-10-20T00:00:00.000Z" },
      { tag: "v1.1.0", date: "2026-11-20T00:00:00.000Z" },
    ];
    assert.equal(releaseFor("2026-10-11T00:00:00Z", releases), "pre-1.0.0");
    assert.equal(releaseFor("2026-10-21T00:00:00Z", releases), "1.0.0");
    assert.equal(releaseFor("2026-12-01T00:00:00Z", releases), "1.1.0");
  });

  it("語彙外・fixed なのに fix_commit が無い・重複 ID を最終検査で落とす", () => {
    const { row } = buildDefect(issue(), ctx());
    const report = createReport();
    checkDefectRows([row, { ...row, severity: "high", status: "fixed", fix_commit: "" }], report);
    const text = report.errors.join("\n");
    assert.match(text, /DEF-006 が重複/);
    assert.match(text, /severity が語彙外（high）/);
    assert.match(text, /fixed なのに fix_commit が無い/);
  });

  it("defect と flaky のラベルの Issue を、重複なく番号順に拾う（他のラベルは拾わない）", () => {
    const picked = selectIssues([
      issue({ number: 25, labels: [{ name: "flaky" }] }),
      issue({ number: 6 }),
      issue({ number: 15, labels: [{ name: "defect" }, { name: "flaky" }] }),
      issue({ number: 22, labels: [{ name: "security" }] }),
      issue({ number: 6 }),
    ]);
    assert.deepEqual(
      picked.map((i) => i.number),
      [6, 15, 25],
    );
    assert.equal(defectId(5), "DEF-005");
  });
});

describe("Issue のスナップショット", () => {
  it("投稿者を残さず、内容が同じなら書き換えない（冪等）。修正 PR の番号を集める", () => {
    const snap = buildSnapshot({
      repository: "o/r",
      issues: [issue({ comments: [{ createdAt: "t", body: "b", author: { login: "x" } }] })],
      fixPrs: {},
      releases: [],
    });
    assert.deepEqual(snap.issues[0].comments, [{ createdAt: "t", body: "b" }]);
    assert.equal(
      sameContent(
        snap,
        buildSnapshot({
          repository: "o/r",
          issues: [issue({ comments: [{ createdAt: "t", body: "b" }] })],
          fixPrs: {},
          releases: [],
        }),
      ),
      true,
    );
    assert.equal(sameContent(null, snap), false);
    assert.deepEqual(fixPrNumbers([issue(), issue({ number: 7 })]), ["9"]);
  });
});
