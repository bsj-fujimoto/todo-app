// consumer contract の provider state（frontend/contracts/frontend-backend.json の given）を、本物の SQLite の状態として作る。
// 状態名は frontend/test/contract/api-client.pact.test.js の STATES と一致させる。
// 各状態は DB をゼロから作り直す（interaction 間で状態が残らない）。backend は操作ごとに DB を開き直すので、再起動は要らない。
import { mkdir, rm } from "node:fs/promises";
import { STANDARD_TASKS } from "../../test-support/datasets.js";
import { corruptDbFile, seedTasks } from "../../test-support/db.js";

/** @param {string} dbPath backend が使っている DB のパス */
export function providerStates(dbPath) {
  const reset = () => rm(dbPath, { recursive: true, force: true });
  return {
    // DS-002（標準 3 件。1 件目の id は frontend の契約が使う）
    "tasks exist": async () => {
      await reset();
      seedTasks(dbPath, STANDARD_TASKS);
    },
    // DS-001（初回起動。ファイル未作成のまま。backend が最初の操作で作る）
    "no tasks exist": reset,
    // DS-007（先頭 100 バイトを 0x00 で上書き）
    "stored data is corrupt": async () => {
      await reset();
      seedTasks(dbPath, STANDARD_TASKS);
      corruptDbFile(dbPath);
    },
    // 書込み不可。DB のパスをディレクトリにして開けなくする（root でも再現できる。chmod は root に効かない）
    "the data store cannot be written": async () => {
      await reset();
      await mkdir(dbPath);
    },
  };
}
