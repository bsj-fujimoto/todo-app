// テストデータ（docs/data/datasets.csv）。backend のテスト支援と同じデータセットを使い、固定ファイルは持たない。
// 乱数・実時刻は使わない。
import {
  MALICIOUS_TITLES,
  SAME_TIME_TASKS,
  STANDARD_TASKS,
  bulkTasks,
} from "../../backend/test-support/index.js";

/** DS-002 標準タスク 3 件（保存順。表示順は 打ち合わせの準備をする → 仕様書をレビューする → 牛乳を買う）。 */
export const DS002 = STANDARD_TASKS;
export const DS002_TITLES = ["打ち合わせの準備をする", "仕様書をレビューする", "牛乳を買う"];

/** DS-004 同時刻タスク 3 件（createdAt が同一。同時刻-A, B, C の順に保存する）。 */
export const DS004 = SAME_TIME_TASKS;

/** DS-005 悪意ある文字列セットのうち、画面に出す 4 種（TC-061）。 */
export const DS005_XSS = MALICIOUS_TITLES.slice(0, 4);

/** DS-006 大量データ 1,000 件（タスク-0001〜タスク-1000、1 秒間隔、偶数番は完了済み）。 */
export const ds006 = () => bulkTasks(1000);

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
