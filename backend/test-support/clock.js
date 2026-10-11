// 決定的な時刻・ID の供給元（実時刻・乱数に依存しないテスト用）。backend/src の clock / idGenerator と同じ形。

/** 常に同じ時刻（ISO 8601 UTC 文字列）を返す clock。 */
export function fixedClock(iso) {
  return () => iso;
}

/**
 * 呼ぶたびに stepMs ミリ秒ずつ進む clock。最初の呼び出しが startIso。
 * callsPerStep を 2 以上にすると、その回数だけ同じ時刻を返してから進む（同時刻のタスクを作りたいとき）。
 */
export function steppingClock(startIso, stepMs = 1000, callsPerStep = 1) {
  const start = Date.parse(startIso);
  let calls = 0;
  return () => new Date(start + stepMs * Math.floor(calls++ / callsPerStep)).toISOString();
}

/**
 * 連番の UUID v4 形式の ID を返す idGenerator。
 * 例: 11111111-1111-4111-8111-000000000001, ...-000000000002
 */
export function sequentialIdGenerator() {
  let counter = 0;
  return () => `11111111-1111-4111-8111-${String(++counter).padStart(12, "0")}`;
}

/** 連番の x-request-id（requestIdGenerator 用）。 */
export function sequentialRequestIds(prefix = "test-req") {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}
