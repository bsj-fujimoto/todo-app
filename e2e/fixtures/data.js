// テストデータ（docs/data/datasets.csv）。固定ファイルを持たず、テストコードの中で生成する。乱数・実時刻は使わない。

/** 形式が有効な固定の UUID v4（n で一意）。 */
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const row = (n, title, completed, createdAt) => ({ id: uuid(n), title, completed, createdAt });

/** DS-002 標準タスク 3 件。表示順は 打ち合わせの準備をする → 仕様書をレビューする → 牛乳を買う。 */
export const DS002 = [
  row(1, "牛乳を買う", false, "2026-10-01T09:00:00.000Z"),
  row(2, "仕様書をレビューする", false, "2026-10-01T09:00:01.000Z"),
  row(3, "打ち合わせの準備をする", true, "2026-10-01T09:00:02.000Z"),
];
export const DS002_TITLES = ["打ち合わせの準備をする", "仕様書をレビューする", "牛乳を買う"];

/** DS-004 同時刻タスク 3 件（createdAt が同一。この順に保存する）。 */
export const DS004 = ["同時刻-A", "同時刻-B", "同時刻-C"].map((title, i) =>
  row(i + 1, title, false, "2026-10-01T09:00:00.000Z"),
);

/** DS-005 悪意ある文字列セット。 */
export const DS005_XSS = [
  "<img src=x onerror=alert(1)>",
  "<script>alert(1)</script>",
  "&lt;b&gt;",
  '"><svg onload=alert(1)>',
];

/** DS-006 大量データ 1,000 件（タスク-0001〜タスク-1000、1 秒間隔、偶数番は完了済み）。 */
export function ds006() {
  const base = Date.UTC(2026, 9, 1, 9, 0, 0);
  return Array.from({ length: 1000 }, (_, i) => {
    const n = i + 1;
    return row(
      n,
      `タスク-${String(n).padStart(4, "0")}`,
      n % 2 === 0,
      new Date(base + i * 1000).toISOString(),
    );
  });
}

/** DS-012 障害注入: 503 STORAGE_FAILURE の応答。 */
export const STORAGE_FAILURE_RESPONSE = {
  status: 503,
  contentType: "application/json",
  body: JSON.stringify({
    error: { code: "STORAGE_FAILURE", message: "保存できませんでした。もう一度お試しください" },
  }),
};

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
