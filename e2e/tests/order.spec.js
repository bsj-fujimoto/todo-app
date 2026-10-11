// 並び順: TC-040（作成日時が同一のとき、保存順の新しいものが先。DS-004 を DB へ直接投入する）。
import { test, expect } from "../fixtures/stack.js";
import { DS004 } from "../fixtures/data.js";

test("[TC-040] 同時刻のタスクは保存順の新しいものが先に並び、再読込しても同じ", async ({ app, stack }) => {
  await stack.seed(DS004);
  await app.open();
  await app.expectTitles(["同時刻-C", "同時刻-B", "同時刻-A"]);

  await app.page.reload();
  await app.expectTitles(["同時刻-C", "同時刻-B", "同時刻-A"]);
  await app.expectNoErrors();

  const { status, body } = await stack.tasks();
  expect(status).toBe(200);
  expect(body.tasks.map((t) => t.title)).toEqual(["同時刻-C", "同時刻-B", "同時刻-A"]);
});
