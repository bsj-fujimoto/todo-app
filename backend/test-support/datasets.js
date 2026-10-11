// テストデータセット（docs/data/datasets.csv の DS-xxx）。id は固定の UUID v4 リテラル。
// seedTasks(dbPath, STANDARD_TASKS) のように使う。配列の順 = 保存順（INSERT 順）。

/** DS-002 標準タスク 3 件（未完了 2・完了 1）。一覧の表示順は 打ち合わせの準備をする → 仕様書をレビューする → 牛乳を買う。 */
export const STANDARD_TASKS = Object.freeze([
  Object.freeze({
    id: "5f1b0c1e-1111-4a11-8a11-000000000001",
    title: "牛乳を買う",
    completed: false,
    createdAt: "2026-10-01T09:00:00.000Z",
  }),
  Object.freeze({
    id: "5f1b0c1e-1111-4a11-8a11-000000000002",
    title: "仕様書をレビューする",
    completed: false,
    createdAt: "2026-10-01T09:00:01.000Z",
  }),
  Object.freeze({
    id: "5f1b0c1e-1111-4a11-8a11-000000000003",
    title: "打ち合わせの準備をする",
    completed: true,
    createdAt: "2026-10-01T09:00:02.000Z",
  }),
]);

/** DS-004 同時刻タスク 3 件（createdAt が同一）。この順に保存する。表示順は 同時刻-C → B → A。 */
export const SAME_TIME_TASKS = Object.freeze(
  ["A", "B", "C"].map((suffix, index) =>
    Object.freeze({
      id: `5f1b0c1e-4444-4a44-8a44-00000000000${index + 1}`,
      title: `同時刻-${suffix}`,
      completed: false,
      createdAt: "2026-10-01T09:00:00.000Z",
    }),
  ),
);

/** DS-005 悪意ある文字列セット（いずれも 100 コードポイント以内）。 */
export const MALICIOUS_TITLES = Object.freeze([
  "<img src=x onerror=alert(1)>",
  "<script>alert(1)</script>",
  "&lt;b&gt;",
  '"><svg onload=alert(1)>',
  "'); DROP TABLE tasks;--",
  "' OR '1'='1",
]);

/**
 * DS-006 大量データ（既定 1,000 件）。タイトル タスク-0001〜、createdAt は 1 秒間隔、偶数番は完了済み。
 * 保存順 = 番号順なので、一覧の先頭は最後の番号。
 */
export function bulkTasks(count = 1000) {
  const start = Date.parse("2026-10-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `5f1b0c1e-6666-4a66-8a66-${String(number).padStart(12, "0")}`,
      title: `タスク-${String(number).padStart(4, "0")}`,
      completed: number % 2 === 0,
      createdAt: new Date(start + index * 1000).toISOString(),
    };
  });
}
