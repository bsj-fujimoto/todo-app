# backend/test-support

backend のテストと e2e が共有する支援コード。**Docker イメージには含めない**（`.dockerignore` で除外）。
すべて ESM の純粋な関数で、e2e からは次のように読み込む。

```js
import { seedTasks, STANDARD_TASKS, spawnBackend } from "@todo-app/backend/test-support";
// または相対パス: ../../backend/test-support/index.js
```

## DB を直接扱う（`db.js`）

| 関数                           | 用途                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `seedTasks(dbPath, rows)`      | スキーマ（マイグレーション v1）を作り、`rows` を配列の順（= 保存順）に INSERT する。同時刻など API では作れないデータ用 |
| `corruptDbFile(dbPath)`        | 先頭 100 バイトを 0x00 で上書きして破損させる（DS-007）                                                  |
| `insertInvalidRow(dbPath, row)` | CHECK 制約を迂回して検証に通らない行を入れる（例: `completed: 2`、`title: ""`、`createdAt: "yesterday"`）   |
| `readRows(dbPath)`             | tasks 全行を保存順で返す（読み取り専用で開くので DB を書き換えない）。列名は `created_at`                  |
| `listTables(dbPath)`           | `sqlite_master` のテーブル名一覧                                                                        |
| `sha256File(path)`             | ファイルの SHA-256。書き換えられていないことの確認用                                                    |

`rows` は `{ id, title, completed?, createdAt }`。backend 停止中、または backend が操作を受けていない間に呼ぶ
（backend は操作ごとに DB を開き直すので、起動中に `seedTasks` / `insertInvalidRow` をしても次の操作から見える）。

```js
const sandbox = await createSandbox(); // 専用の一時ディレクトリ。終了時に必ず await sandbox.cleanup()
seedTasks(sandbox.dbPath, STANDARD_TASKS); // DS-002
const backend = await spawnBackend({ dbPath: sandbox.dbPath });
// ... backend.url を叩く ...
await backend.stop();
await sandbox.cleanup(); // chmod 0444 のままでも権限を戻して削除する
```

## データセット（`datasets.js`）

`STANDARD_TASKS`（DS-002: 標準 3 件）、`SAME_TIME_TASKS`（DS-004: 同時刻 3 件）、`MALICIOUS_TITLES`（DS-005）、
`bulkTasks(count = 1000)`（DS-006）。id は固定の UUID v4 リテラル。

## 実プロセスの起動（`process.js`）

`spawnBackend({ dbPath, env })` は `src/main.js` を子プロセスで起動し、空きポート（`PORT=0`）で待ち受けた
`{ url, port, logs(), waitForLog(predicate), stop(signal) }` を返す。`HOST=127.0.0.1`・`LOG_LEVEL=info` が既定で、
`env` で `COMMIT_SHA` などを上書きできる。ログは pino の JSON 行を `logs()` でパースして返す
（応答の直後はログが未着のことがあるので、検査には `waitForLog` を使う）。同じ `dbPath` で `stop()` → `spawnBackend()` すれば再起動を再現できる。

## 決定的な時刻・ID（`clock.js`）

`fixedClock(iso)`、`steppingClock(startIso, stepMs = 1000, callsPerStep = 1)`、`sequentialIdGenerator()`（UUID v4 形式の連番）、
`sequentialRequestIds(prefix)`。`buildApp({ clock, idGenerator, ... })` に注入する（clock は ISO 8601 UTC 文字列を返す関数）。

## 注意

- 保存失敗（DS-008）の再現は `chmod(dbPath, 0o444)`。root は読取専用ビットを無視するので、root 以外で実行する。
- backend は `journal_mode` を既定（DELETE）のまま使う。WAL にすると `-wal` / `-shm` が増え、読取専用の再現が変わる。
