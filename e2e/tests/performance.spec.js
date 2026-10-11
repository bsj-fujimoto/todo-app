// 性能（暫定しきい値。UNK-002）: TC-074（1,000 件の表示完了 2,000ms 以下、各操作の反映 1,000ms 以下）。実測値は注釈に残す。
import { test, expect } from "../fixtures/stack.js";
import { ds006 } from "../fixtures/data.js";

const DISPLAY_THRESHOLD_MS = 2000;
const OPERATION_THRESHOLD_MS = 1000;

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
  async ({ app, stack, page }) => {
    await stack.seed(ds006());
    const timings = {};

    timings["表示完了"] = await measure(
      () => page.goto("/"),
      async () => {
        await expect(app.rows).toHaveCount(1000);
        await expect(app.titles.first()).toHaveText("タスク-1000");
      },
    );
    expect(timings["表示完了"]).toBeLessThanOrEqual(DISPLAY_THRESHOLD_MS);

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
      test.info().annotations.push({ type: "実測(ms)", description: `${name}: ${ms}` });
    }
    for (const name of ["追加", "完了切替", "削除"])
      expect(timings[name]).toBeLessThanOrEqual(OPERATION_THRESHOLD_MS);

    expect(stack.calls("GET").map((c) => c.status)).toEqual([200]);
    expect(stack.calls("GET")[0].responseBody.tasks).toHaveLength(1000);
    expect(stack.calls("POST").map((c) => c.status)).toEqual([201]);
    expect(stack.calls("PATCH").map((c) => c.status)).toEqual([200]);
    expect(stack.calls("DELETE").map((c) => c.status)).toEqual([204]);
    expect((await stack.tasks()).body.tasks).toHaveLength(1000);
  },
);
