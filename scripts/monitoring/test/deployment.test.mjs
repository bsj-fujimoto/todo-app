// incident のデプロイ相関（deployment_ref・マーカー履歴・incident 台帳）の単体テスト。通信は偽の deps、ファイルは実リポジトリの台帳。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { issueBody } from "../lib/alert-core.mjs";
import { describeDeployment, markerFromLastRun, resolveDeployment } from "../lib/deployment.mjs";
import { checkIncidents, parseCsv } from "../lib/incident-ledger.mjs";
import { deploymentChanges, mergeMarkers, withRunInfo } from "../lib/marker-history.mjs";

const MARKER = {
  at: "2026-10-11T12:43:32.490Z",
  version: "1.0.0",
  commit_sha: "2c357a6df29924294c6df29829a2aa697572a6e2",
  status: "ok",
  release_tag: null,
  release_published_at: null,
};
const RELEASE_MARKER = {
  ...MARKER,
  at: "2026-10-12T01:17:31.855Z",
  commit_sha: "5fcf40a7e58dc253e53ff56860d0669a69abda26",
  release_tag: "v1.0.0",
  release_published_at: "2026-10-11T15:46:54Z",
  mode: "release",
};

describe("describeDeployment（deployment_ref）", () => {
  it("この run のマーカー: version・commit・観測時刻・対象（fallback は main の先頭）・リリースの有無", () => {
    const t = describeDeployment({ marker: MARKER, run: { mode: "fallback" }, source: { kind: "this-run" } });
    assert.match(t, /version 1\.0\.0、commit 2c357a6df/);
    assert.match(t, /health の観測 2026-10-11T12:43:32\.490Z/);
    assert.match(t, /fallback（main の先頭をビルド/);
    assert.match(t, /最新リリースなし/);
  });
  it("アプリを起動していない実行は、直近の synthetic 実行のマーカーと、その run を明記する", () => {
    const source = { kind: "last-synthetic-run", run_id: 38191254696, created_at: "2026-10-12T01:16:32Z" };
    const t = describeDeployment({ marker: RELEASE_MARKER, run: { mode: "n/a" }, source });
    assert.match(t, /この実行はアプリを起動していないため、直近の synthetic 実行（run 38191254696/);
    assert.match(t, /リリースのイメージ（digest 固定）/);
    assert.match(t, /最新リリース v1\.0\.0（公開 2026-10-11T15:46:54Z）/);
  });
  it("取れないときは「取れない: 理由」と書き、「不明」とは書かない。参考値は版ではないと明記する", () => {
    const t = describeDeployment({
      marker: null,
      reason: "直近の synthetic 実行から取れなかった",
      reference: {
        release_tag: "v1.0.0",
        release_published_at: "t",
        main_head: { sha: "abc", committed_at: "t2" },
      },
    });
    assert.match(t, /^取れない: 直近の synthetic 実行から取れなかった/);
    assert.match(t, /参考（デプロイしている版ではない）: 最新リリース v1\.0\.0.*main の先頭 abc/);
    assert.doesNotMatch(t, /不明/);
  });
  it("health に届かず version が読めないマーカーは、取れない理由に status を書く", () => {
    const t = describeDeployment({ marker: { ...MARKER, version: null, status: "unreachable: timeout" } });
    assert.match(t, /^取れない: health に到達できず.*unreachable: timeout/);
  });
  it("incident の本文に deployment_ref として載る", () => {
    const result = {
      at: "t",
      severity: "sev3",
      monitor_id: "MON-META",
      name: "n",
      type: "infra",
      failure_detail: "x",
      attempts: 1,
    };
    const text = describeDeployment({
      marker: MARKER,
      run: { mode: "fallback" },
      source: { kind: "this-run" },
    });
    const body = issueBody({
      result,
      run: { mode: "fallback", region: "r" },
      route: null,
      owner: "o",
      deploymentText: text,
    });
    assert.match(body, /- 直前のデプロイ（deployment_ref）: version 1\.0\.0、commit 2c357a6/);
  });
});

describe("resolveDeployment（どのマーカーを使うか）", () => {
  const base = {
    readThisRun: () => null,
    listRuns: async () => [],
    runMarker: async () => null,
    reference: async () => ({ release_tag: "v1.0.0" }),
  };
  it("この run のマーカーがあればそれを使う（直近の run は見ない）", async () => {
    const d = await resolveDeployment({ ...base, readThisRun: () => MARKER }, { fromLastRun: true });
    assert.equal(d.source.kind, "this-run");
  });
  it("アプリを起動していない実行は、直近の synthetic 実行のうちマーカーが取れた最新を使う", async () => {
    const deps = {
      ...base,
      listRuns: async () => [
        { databaseId: 3, createdAt: "c3" },
        { databaseId: 2, createdAt: "c2" },
      ],
      runMarker: async (id) => (id === 2 ? RELEASE_MARKER : null),
    };
    const d = await resolveDeployment(deps, { fromLastRun: true });
    assert.equal(d.source.run_id, 2);
    assert.equal(d.marker.release_tag, "v1.0.0");
  });
  it("どの run からも取れなければ、試した run を理由に書き、参考値を付ける", async () => {
    const deps = { ...base, listRuns: async () => [{ databaseId: 9, createdAt: "c" }] };
    const d = await resolveDeployment(deps, { fromLastRun: true });
    assert.equal(d.marker, null);
    assert.match(d.reason, /9/);
    assert.equal(d.reference.release_tag, "v1.0.0");
  });
  it("gh の失敗（例外）でも例外にせず、理由を残す", async () => {
    const deps = {
      ...base,
      listRuns: async () => {
        throw new Error("403");
      },
      reference: async () => {
        throw new Error("403");
      },
    };
    const d = await resolveDeployment(deps, { fromLastRun: true });
    assert.equal(d.marker, null);
    assert.match(d.reason, /取得できなかった/);
    assert.equal(d.reference, null);
  });
  it("markerFromLastRun は maxTries までしか試さない", async () => {
    let n = 0;
    const deps = {
      listRuns: async () => Array.from({ length: 9 }, (_, i) => ({ databaseId: i, createdAt: "c" })),
      runMarker: async () => {
        n += 1;
        return null;
      },
    };
    await markerFromLastRun(deps, 3);
    assert.equal(n, 3);
  });
});

describe("マーカー履歴", () => {
  const run = { databaseId: 1, event: "schedule", url: "u" };
  it("同じ run の同じ観測は 1 行。既存の行（artifact の期限切れ後）は残し、時刻順に並べる", () => {
    const a = withRunInfo(RELEASE_MARKER, run, { mode: "release" });
    const b = withRunInfo(MARKER, { ...run, databaseId: 2 }, { mode: "fallback" });
    const merged = mergeMarkers([a], [a, b]);
    assert.deepEqual(
      merged.map((m) => m.run_id),
      [2, 1],
    );
    assert.equal(merged[1].mode, "release");
  });
  it("版（commit・リリース・対象の種別）が変わった点をデプロイとして数える", () => {
    const mk = (at, commit, tag, mode) => ({
      at,
      version: "1.0.0",
      commit_sha: commit,
      release_tag: tag,
      mode,
      run_id: at,
    });
    const rows = [
      mk("1", "a", null, "fallback"),
      mk("2", "a", null, "fallback"),
      mk("3", "b", null, "fallback"),
      mk("4", "c", "v1", "release"),
      mk("5", "c", "v1", "release"),
    ];
    assert.deepEqual(
      deploymentChanges(rows).map((c) => c.at),
      ["1", "3", "4"],
    );
  });
});

describe("incident 台帳（incidents.csv・drill-issues.csv）", () => {
  const read = (p) => readFileSync(p, "utf8");
  const real = () => ({
    incidentsCsv: read("monitoring/incidents.csv"),
    drillCsv: read("monitoring/drill-issues.csv"),
    markersJsonl: read("monitoring/markers/deployment-markers.jsonl"),
  });
  it('parseCsv は引用符・引用符内のカンマ・改行・"" を読む', () => {
    const rows = parseCsv('a,b\n1,"x,y"\n"p ""q""","l1\nl2"\n');
    assert.deepEqual(rows, [
      { a: "1", b: "x,y" },
      { a: 'p "q"', b: "l1\nl2" },
    ]);
  });
  it("リポジトリの台帳は整合している（直前のデプロイが実在のマーカー履歴と対応、真因・還流先あり）", () => {
    assert.deepEqual(checkIncidents(real()), []);
    const rows = parseCsv(real().incidentsCsv);
    assert.deepEqual(
      rows.map((r) => r.incident_id),
      ["ISSUE-36", "ISSUE-59"],
    );
    const i36 = rows[0];
    assert.match(i36.root_cause_ref, /PR #12/);
    assert.match(i36.deployment_is_root_cause, /^no/);
    assert.match(i36.deployment_ref, /2c357a6/);
    assert.equal(i36.defect_ids, "DEF-036");
  });
  it("deployment_ref が「不明」、マーカーの時刻が履歴に無い、真因が空、を検出する", () => {
    const rows = parseCsv(real().incidentsCsv);
    const toCsv = (rs) =>
      `${Object.keys(rs[0]).join(",")}\n${rs
        .map((r) =>
          Object.values(r)
            .map((v) => `"${v.replace(/"/g, '""')}"`)
            .join(","),
        )
        .join("\n")}\n`;
    const bad = rows.map((r) => ({ ...r }));
    bad[0].deployment_ref = "不明（デプロイマーカーなし）";
    bad[1].deployment_marker_at = "2000-01-01T00:00:00Z";
    bad[1].root_cause_at = "";
    const p = checkIncidents({ ...real(), incidentsCsv: toCsv(bad) }).join("\n");
    assert.match(p, /「不明」/);
    assert.match(p, /deployment_marker_at 2000-01-01/);
    assert.match(p, /root_cause_at が空/);
  });
  it("drill は incident の台帳に混ぜず別の台帳に置く（還流の対象外と明記）", () => {
    const drills = parseCsv(real().drillCsv).map((d) => d.issue_number);
    assert.deepEqual(drills, ["13", "14", "17", "18", "44", "45", "48", "49", "50", "63", "67", "68"]);
    assert.ok(parseCsv(real().drillCsv).every((d) => /対象外/.test(d.feedback)));
  });
});
