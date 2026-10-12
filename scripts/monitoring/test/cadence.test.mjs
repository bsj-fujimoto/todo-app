// schedule の実行間隔の実測・watchdog のしきい値・設定の整合（宣言と実測）の単体テスト。時刻は引数で渡す。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "yaml";
import {
  intervalsSec,
  parseCron,
  recommendThresholdHours,
  slotsBetween,
  stats,
  summarizeWorkflow,
} from "../lib/cadence.mjs";
import { checkConfig } from "../lib/config-check.mjs";
import { lastRanRun, staleTitle } from "../lib/watchdog.mjs";

const T = (iso) => Date.parse(iso);

describe("cron の展開", () => {
  it("7,37 * * * * は 1 時間に 2 枠（30 分間隔）", () => {
    const slots = slotsBetween("7,37 * * * *", T("2026-10-12T00:00:00Z"), T("2026-10-12T02:00:00Z"));
    assert.deepEqual(
      slots.map((s) => new Date(s).toISOString().slice(11, 16)),
      ["00:07", "00:37", "01:07", "01:37"],
    );
  });
  it("47 */3 * * * は 3 時間ごと、0 20 * * 0 は日曜だけ", () => {
    const h = slotsBetween("47 */3 * * *", T("2026-10-12T00:00:00Z"), T("2026-10-12T23:59:00Z"));
    assert.equal(h.length, 8);
    const sun = slotsBetween("0 20 * * 0", T("2026-10-11T00:00:00Z"), T("2026-10-18T23:00:00Z"));
    assert.deepEqual(
      sun.map((s) => new Date(s).toISOString()),
      ["2026-10-11T20:00:00.000Z", "2026-10-18T20:00:00.000Z"],
    );
  });
  it("不正な cron は例外（日・月の指定は未対応）", () => {
    assert.throws(() => parseCron("* * 1 * *"), /未対応/);
    assert.throws(() => parseCron("*/0 * * * *"), /ステップ/);
    assert.throws(() => parseCron("61 * * * *"), /範囲/);
  });
});

describe("間隔の統計", () => {
  it("隣り合う差と、中央値・p90・最大", () => {
    const gaps = intervalsSec([
      T("2026-10-12T00:00:00Z"),
      T("2026-10-12T01:00:00Z"),
      T("2026-10-12T04:00:00Z"),
    ]);
    assert.deepEqual(gaps, [3600, 10800]);
    const s = stats(gaps);
    assert.equal(s.median, 7200);
    assert.equal(s.max, 10800);
    assert.equal(stats([]).n, 0);
  });
});

describe("summarizeWorkflow（宣言と実測）", () => {
  const runs = [
    "2026-10-11T18:01:35Z",
    "2026-10-11T21:52:01Z",
    "2026-10-12T01:16:32Z",
    "2026-10-12T07:57:03Z",
  ].map((created_at) => ({ created_at, event: "schedule", conclusion: "success" }));
  const w = summarizeWorkflow({
    file: "synthetic.yml",
    crons: ["7,37 * * * *"],
    runs: [
      ...runs,
      { created_at: "2026-10-11T16:20:15Z", event: "workflow_dispatch", conclusion: "success" },
    ],
    windowStartIso: "2026-10-11T12:36:39Z",
    nowMs: T("2026-10-12T08:02:23Z"),
  });
  it("宣言は 30 分、schedule の実行は 4 回で、欠落は枠の数 - 実行数", () => {
    assert.equal(w.declared.interval_sec, 1800);
    assert.equal(w.schedule.runs, 4);
    assert.equal(w.schedule.missing, w.declared.slots_in_window - 4);
    assert.ok(w.schedule.missing > 30);
  });
  it("実効間隔は 3.8・3.4・6.7 時間。手動実行は schedule の間隔に入れない", () => {
    assert.deepEqual(
      w.schedule.intervals_sec.map((s) => Math.round(s / 360) / 10),
      [3.8, 3.4, 6.7],
    );
    assert.equal(w.all_events.by_event.workflow_dispatch, 1);
  });
  it("欠落があるときは、枠からの遅れを出さない（対応づけられない）", () => {
    assert.deepEqual(w.schedule.delays_sec, []);
  });
  it("欠落が無ければ、枠からの遅れを時刻順に 1 対 1 で出す", () => {
    const n = summarizeWorkflow({
      file: "nightly.yml",
      crons: ["0 18 * * *"],
      runs: [{ created_at: "2026-10-11T21:25:56Z", event: "schedule", conclusion: "success" }],
      windowStartIso: "2026-10-11T08:37:22Z",
      nowMs: T("2026-10-12T08:00:00Z"),
    });
    assert.equal(n.schedule.missing, 0);
    assert.deepEqual(n.schedule.delays_sec, [12356]);
  });
});

describe("watchdog のしきい値と、実際に動いた run", () => {
  it("しきい値 = 最大実測間隔を切り上げ + 1 時間。標本が 3 件未満なら決めない", () => {
    assert.equal(recommendThresholdHours(24031, 3).hours, 8);
    assert.equal(recommendThresholdHours(7200, 3).hours, 3);
    assert.equal(recommendThresholdHours(24031, 2).hours, null);
    assert.equal(recommendThresholdHours(null, 0).hours, null);
  });
  it("skipped・cancelled の run は「監視が動いた」に数えない。実行中は数える", () => {
    const runs = [
      { createdAt: "2026-10-12T10:00:00Z", conclusion: "skipped" },
      { createdAt: "2026-10-12T09:00:00Z", conclusion: "cancelled" },
      { createdAt: "2026-10-12T08:00:00Z", conclusion: "success" },
    ];
    assert.equal(lastRanRun(runs).createdAt, "2026-10-12T08:00:00Z");
    runs.unshift({ createdAt: "2026-10-12T10:30:00Z", conclusion: "" });
    assert.equal(lastRanRun(runs).createdAt, "2026-10-12T10:30:00Z");
    assert.equal(lastRanRun([{ createdAt: "2026-10-12T10:00:00Z", conclusion: "skipped" }]), null);
  });
  it("Issue のタイトルはしきい値の時間を含む", () => {
    assert.equal(staleTitle(8), "外形監視が 8 時間以上実行されていない");
  });
});

describe("config-check（宣言・実測・しきい値・cron の整合）", () => {
  const read = (p) => readFileSync(p, "utf8");
  const base = () => ({
    monitorsDoc: parse(read("monitoring/monitors.yaml")),
    routes: parse(read("monitoring/alert-routes.yaml")),
    runbooksDoc: parse(read("monitoring/runbooks/index.yaml")),
    slo: parse(read("perf/slo.yaml")),
    journeys: ["J-01", "J-02", "J-03", "J-04", "J-05"],
    read,
    workflowDoc: parse(read(".github/workflows/synthetic.yml")),
  });
  it("リポジトリの設定は整合している（interval_sec は cron の間隔、しきい値は最大実測間隔 + 1 時間以上）", () => {
    assert.deepEqual(checkConfig(base()), []);
  });
  it("しきい値が最大実測間隔 + 余裕に足りない（誤報を量産する）と検出する", () => {
    const c = base();
    c.monitorsDoc.watchdog.threshold_hours = 3;
    assert.match(checkConfig(c).join("\n"), /誤報を量産/);
  });
  it("実測が無い・実測の記録ファイルが無い・interval_sec と cron が違うと検出する", () => {
    const c = base();
    delete c.monitorsDoc.defaults.observed_interval_sec;
    c.monitorsDoc.defaults.interval_sec = 300;
    c.read = (p) => (p.startsWith("monitoring/cadence/") ? null : read(p));
    const problems = checkConfig(c).join("\n");
    assert.match(problems, /observed_interval_sec/);
    assert.match(problems, /observed_source/);
    assert.match(problems, /cron の間隔/);
  });
});
