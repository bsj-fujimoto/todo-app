// データ投入（API 経由、DS-006）。TARGET 件になるまでタイトル タスク-0001… を追加し、偶数番は完了済みにする。
// 既に TARGET 件以上あれば何もしない。投入は計測の対象外（run.sh は seed の結果を判定に使わない）。
// createdAt は backend が作成時刻で採番するため、DS-006 の「1 秒間隔」は再現できない（perf/README.md に記載）。
import http from "k6/http";
import { check } from "k6";
import { API, countTasks, envInt } from "./lib/common.js";

const TARGET = envInt("TARGET", 1000);
const BATCH = 25;
const HEADERS = { headers: { "Content-Type": "application/json" }, tags: { phase: "seed" } };

export const options = {
  scenarios: { seed: { executor: "shared-iterations", vus: 1, iterations: 1, maxDuration: "30m" } },
  summaryTrendStats: ["avg", "p(95)", "max", "count"],
};

function postBatch(from, to) {
  const reqs = [];
  for (let n = from; n <= to; n += 1) {
    const title = `タスク-${String(n).padStart(4, "0")}`;
    reqs.push(["POST", `${API}/tasks`, JSON.stringify({ title }), HEADERS]);
  }
  return http.batch(reqs);
}

function completeEvens(from, responses) {
  const patches = [];
  responses.forEach((res, i) => {
    if ((from + i) % 2 === 0 && res.status === 201) {
      patches.push(["PATCH", `${API}/tasks/${res.json().id}`, JSON.stringify({ completed: true }), HEADERS]);
    }
  });
  return patches.length ? http.batch(patches) : [];
}

export default function () {
  let n = countTasks() + 1;
  let failures = 0;
  while (n <= TARGET) {
    const to = Math.min(n + BATCH - 1, TARGET);
    const created = postBatch(n, to);
    const patched = completeEvens(n, created);
    failures +=
      created.filter((r) => r.status !== 201).length + patched.filter((r) => r.status !== 200).length;
    n = to + 1;
  }
  check(failures, { 投入に失敗が無い: (f) => f === 0 });
  check(countTasks(), { [`投入後の件数が ${TARGET} 以上`]: (c) => c >= TARGET });
}

export function handleSummary() {
  return { stdout: `[k6:seed] target=${TARGET}\n` };
}
