// 所要時間の計算（純粋関数）。run 全体の所要（wall-clock）と、層ごとの所要（その層を流すジョブの開始から終了まで）を求める。
// run 全体: run の開始時刻（github.run_started_at）から、この記録を作った時点まで。集約ジョブ（ci-result）は run の最後に動くので、ほぼ run 全体になる。
// 層ごと: GitHub API の run のジョブ一覧（started_at・completed_at）から、その層を流したジョブの所要。並列の matrix（e2e の 4 project）は最長のもの。
// 健全性の推移（scripts/regression/lib/health.mjs）も、同じ定義（run の開始〜終了の wall-clock）で所要を出す。

/** 開始〜終了の経過秒（整数に丸める。どちらかが無ければ null）。 */
export function elapsedSec(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const ms = Date.parse(endIso) - Date.parse(startIso);
  return Number.isNaN(ms) ? null : Math.max(0, Math.round(ms / 1000));
}

/** 層 → それを流すジョブ（表示名の末尾。再利用ワークフローの呼び出しでは「呼び出し側 / 呼ばれた側」になる）。 */
export const LAYER_JOBS = {
  // nightly.yml は unit と api を 1 つのジョブ（unit-api）で流す
  unit: /(^| \/ )unit(-api)?$/,
  api: /(^| \/ )(api|unit-api)$/,
  contract: /(^| \/ )contract$/,
  e2e: /(^| \/ )e2e \(/,
  compose: /(^| \/ )compose$/,
};

/** GitHub API のジョブ一覧 → 完了したジョブの所要。 */
export function jobTimings(jobs) {
  return (jobs ?? [])
    .filter((j) => j.started_at && j.completed_at)
    .map((j) => ({
      name: j.name,
      conclusion: j.conclusion ?? null,
      started_at: j.started_at,
      completed_at: j.completed_at,
      duration_sec: elapsedSec(j.started_at, j.completed_at),
    }));
}

/** 層ごとの所要: { layer: { duration_sec（最長のジョブ）, job_time_sum_sec（ジョブ時間の合計）, jobs } }。 */
export function layerTimings(timings) {
  return Object.fromEntries(
    Object.entries(LAYER_JOBS)
      .map(([layer, re]) => [layer, timings.filter((t) => re.test(t.name))])
      .filter(([, ts]) => ts.length > 0)
      .map(([layer, ts]) => [
        layer,
        {
          duration_sec: Math.max(...ts.map((t) => t.duration_sec)),
          job_time_sum_sec: ts.reduce((n, t) => n + t.duration_sec, 0),
          jobs: ts.map((t) => t.name).sort(),
        },
      ]),
  );
}
