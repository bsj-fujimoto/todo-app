// 性能の番兵（UNK-002）: TC-074（1,000 件の表示完了 2,000ms 以下、各操作の反映 1,000ms 以下）。実測値は必ず観察値に残す。
// SLO の本判定は perf 層（perf/slo.yaml の screen_ready_ms=2000ms、api_*_p95_ms=300ms を k6・screen 計測で判定）が行い、
// ここ（機能テスト層）は「桁が違う劣化」を見つける番兵。
import { test, expect } from "../fixtures/stack.js";
import { ds006 } from "../fixtures/data.js";

// 負荷が変わる共有ランナー（GitHub Actions）では、同じコードで 追加が 1054ms になり、しきい値 1000ms を超えて不安定だった（#37）。
// CI の通常値は 追加 288〜411ms・完了切替 150〜228ms・削除 215〜292ms・表示完了 384〜481ms（main の CI 9 回。ローカルは 61〜113ms）で、
// 計測には expect の再試行間隔（100→250→500→1000ms）の粒度も含まれる。CI（環境変数 CI あり）では 3 倍の余裕を持たせる（TC-073 と同じ係数）。
// ローカルは従来の厳しい値のまま。
const SLACK = process.env.CI ? 3 : 1;
const DISPLAY_THRESHOLD_MS = 2000 * SLACK;
const OPERATION_THRESHOLD_MS = 1000 * SLACK;

/** action を実行し、condition が満たされるまでの時間（ミリ秒）を返す。 */
async function measure(action, condition) {
  const start = performance.now();
  await action();
  await condition();
  return Math.round(performance.now() - start);
}

test(
  "[TC-074] 1,000 件でも表示は 2,000ms 以内、追加・完了・削除は 1,000ms 以内に反映される",
  { tag: ["@perf", "@pending"] },
  async ({ app, stack, page, observe }) => {
    await stack.seed(ds006());
    const timings = {};

    timings["表示完了"] = await measure(
      () => page.goto("/"),
      async () => {
        await expect(app.rows).toHaveCount(1000);
        await expect(app.titles.first()).toHaveText("タスク-1000");
      },
    );

    timings["追加"] = await measure(
      () => app.add("性能確認"),
      async () => {
        await expect(app.rows).toHaveCount(1001);
        await expect(app.titles.first()).toHaveText("性能確認");
      },
    );

    timings["完了切替"] = await measure(
      () => app.checkbox("性能確認").click(),
      () => app.expectStrikethrough("性能確認", true),
    );

    timings["削除"] = await measure(
      () => app.deleteButton("タスク-0001").click(),
      async () => {
        await expect(app.rows).toHaveCount(1000);
        await expect(app.titles.last()).toHaveText("タスク-0002");
      },
    );

    for (const [name, ms] of Object.entries(timings)) {
      observe(`${name}(ms)`, ms);
    }
    observe(
      "しきい値(ms)",
      `表示完了 ${DISPLAY_THRESHOLD_MS}、各操作 ${OPERATION_THRESHOLD_MS}（係数 ${SLACK}）`,
    );
    expect(timings["表示完了"]).toBeLessThanOrEqual(DISPLAY_THRESHOLD_MS);
    for (const name of ["追加", "完了切替", "削除"])
      expect(timings[name], `${name}の反映時間(ms)`).toBeLessThanOrEqual(OPERATION_THRESHOLD_MS);

    expect(stack.calls("GET").map((c) => c.status)).toEqual([200]);
    expect(stack.calls("GET")[0].responseBody.tasks).toHaveLength(1000);
    expect(stack.calls("POST").map((c) => c.status)).toEqual([201]);
    expect(stack.calls("PATCH").map((c) => c.status)).toEqual([200]);
    expect(stack.calls("DELETE").map((c) => c.status)).toEqual([204]);
    expect(await stack.db()).toHaveLength(1000);
  },
);
