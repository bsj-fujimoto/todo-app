// 記録（kind: measured / proxy、env_class、比較条件）と、画面計測のサーバ観測の時刻整合の単体テスト。ファイルは一時ディレクトリだけ。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { comparisonInfo, pickBaseline } from "../lib/compare-rules.mjs";
import { UNAVAILABLE, buildRun } from "../lib/record-build.mjs";
import { analyzeScreenObserve, windowOf } from "../lib/screen-observe.mjs";

const BASELINES = [
  { release: "initial", env_class: "local:darwin-arm64", run_id: "r1", commit_sha: "a", measured_at: "t1" },
  {
    release: "v1.0.0",
    env_class: "github-hosted:ubuntu24:X64",
    run_id: "r2",
    commit_sha: "b",
    measured_at: "t2",
  },
  {
    release: "v1.1.0",
    env_class: "github-hosted:ubuntu24:X64",
    run_id: "r3",
    commit_sha: "c",
    measured_at: "t3",
  },
];

describe("比較条件（env_class）", () => {
  it("同じ env_class の最新の基準だけを選ぶ。release を指定しても区分が違えば選ばない", () => {
    assert.equal(pickBaseline(BASELINES, "github-hosted:ubuntu24:X64").release, "v1.1.0");
    assert.equal(pickBaseline(BASELINES, "local:darwin-arm64").release, "initial");
    assert.equal(pickBaseline(BASELINES, "local:darwin-arm64", "v1.0.0"), undefined);
  });
  it("比較の出力に env_class の一致と基準の release・run・commit を持つ（機械可読）", () => {
    const c = comparisonInfo(BASELINES, "github-hosted:ubuntu24:X64");
    assert.equal(c.status, "compared");
    assert.equal(c.env_class_match, true);
    assert.equal(c.baseline_release, "v1.1.0");
    assert.equal(c.baseline_run_id, "r3");
    assert.equal(c.baseline_commit_sha, "c");
    assert.equal(c.baseline_env_class, c.env_class);
  });
  it("基準が無い区分は比べない（status not_compared、一致は null）。他の区分の一覧を理由に残す", () => {
    const c = comparisonInfo(BASELINES, "github-hosted:ubuntu24:ARM64");
    assert.equal(c.status, "not_compared");
    assert.equal(c.env_class_match, null);
    assert.equal(c.baseline_release, null);
    assert.match(c.reason, /local:darwin-arm64/);
  });
});

describe("run の記録（perf-runs.json の 1 件）", () => {
  const run = {
    run_id: "x",
    env_class: "github-hosted:ubuntu24:X64",
    commit_sha: "abc",
    started_at: "2026-10-12T00:00:00Z",
    host: { platform: "linux", arch: "x64", cpu_model: "cpu", cpu_count: 4 },
    runner: { github_actions: true, image_os: "ubuntu24", image_version: "1" },
    docker: { server_version: "28", vm: { ncpu: 4, mem_total_bytes: 16 * 1024 ** 3 } },
    k6: { version: "k6 v2" },
    script_sha256: {},
    config_sha256: { "perf/workload.yaml": "sha" },
  };
  const observe = {
    window_samples: 30,
    services: { backend: { cpu_pct: { n: 30 }, memory: { start_mib: 1 } } },
    health: { n: 30 },
    db: { start_bytes: 1 },
  };
  const ctx = (comparison) => ({
    run,
    envDoc: { env_diff: [], data_profile: {} },
    metrics: {},
    analyses: { screen: [{ observe }] },
    comparison,
  });
  const v = { scenario: "screen", status: "pass", iterations: 10, warmup_sec: 1 };

  it("server_metrics の各ソースに kind（measured / proxy）と何を測ったか（what）が付く", () => {
    const r = buildRun(ctx(null), v);
    const kinds = Object.fromEntries(r.server_metrics.map((s) => [s.source, s.kind]));
    assert.deepEqual(kinds, { cpu: "measured", memory: "measured", db: "proxy", apm: "proxy" });
    assert.ok(
      r.server_metrics.every((s) => s.time_aligned === true && s.what && s.ref.startsWith("screen/")),
    );
  });
  it("取れないもの（APM エージェント・DB 指標・キュー・外部依存）を理由つきで残す", () => {
    const r = buildRun(ctx(null), v);
    assert.deepEqual(
      r.server_metrics_unavailable.map((u) => u.source),
      UNAVAILABLE.map((u) => u.source),
    );
    assert.ok(r.server_metrics_unavailable.every((u) => u.reason));
  });
  it("env_class と、基準との比較条件を持つ", () => {
    const comparison = comparisonInfo(BASELINES, run.env_class);
    const r = buildRun(ctx(comparison), v);
    assert.equal(r.env_class, "github-hosted:ubuntu24:X64");
    assert.equal(r.comparison.env_class_match, true);
  });
});

describe("画面計測のサーバ観測（時刻整合）", () => {
  const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), "screen-"));
    const screen = {
      started_at: "2026-10-12T00:00:10.000Z",
      finished_at: "2026-10-12T00:00:20.000Z",
      tasks: 1000,
    };
    writeFileSync(join(dir, "screen.json"), JSON.stringify(screen));
    mkdirSync(join(dir, "obs-1000"));
    const rows = [];
    for (let s = 5; s <= 25; s += 1) {
      const ts = `2026-10-12T00:00:${String(s).padStart(2, "0")}.000Z`;
      rows.push({ kind: "docker_stats", ts, service: "backend", cpu_pct: 10 + s, mem_bytes: 5e7 + s });
      rows.push({ kind: "docker_stats", ts, service: "frontend", cpu_pct: 1, mem_bytes: 1e7 });
      rows.push({ kind: "health", ts, status: 200, body_ok: true, ms: 20 });
      rows.push({ kind: "db", ts, bytes: 1000 + s, files: {}, error: null });
    }
    writeFileSync(join(dir, "obs-1000", "observe.jsonl"), jsonl(rows));
    return dir;
  }
  it("窓は started_at〜finished_at。窓の中のサンプルだけを要約する", async () => {
    const dir = fixture();
    const a = await analyzeScreenObserve(dir, ["backend", "frontend"]);
    assert.equal(a.scenario, "screen");
    assert.equal(a.time_alignment.k6_start, "2026-10-12T00:00:10.000Z");
    assert.equal(a.observe.window_samples, 11 * 4); // 10〜20 秒 × (backend・frontend・health・db)
    assert.ok(a.observe.services.backend.cpu_pct.n >= 11);
    assert.ok(a.observe.health.n === 11 && a.observe.db);
    assert.ok(JSON.parse(readFileSync(join(dir, "analysis.json"), "utf8")).by_tasks["1000"]);
  });
  it("観測が無い（古い run）なら null。窓が決まらない screen.json は窓なし", async () => {
    const dir = mkdtempSync(join(tmpdir(), "screen-"));
    writeFileSync(
      join(dir, "screen.json"),
      JSON.stringify({ started_at: "2026-10-12T00:00:00Z", tasks: 1000 }),
    );
    assert.equal(await analyzeScreenObserve(dir, ["backend"]), null);
    assert.equal(windowOf({ started_at: "x" }), null);
  });
});
