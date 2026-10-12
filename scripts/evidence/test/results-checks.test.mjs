// check-evidence の run-roles・api-results 検査（check-all.mjs）。合成のデータで、ファイルを読まない。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { API_RESULT_COLUMNS } from "../lib/api-results.mjs";
import { apiResults, runRoles } from "../lib/check-all.mjs";

describe("check-evidence の run-roles・api-results 検査", () => {
  const roles = [
    { run_ref: "gh-run-1", role: "target", reason: "" },
    { run_ref: "gh-run-0", role: "history", reason: "取り替えた" },
  ];

  it("run-roles: 台帳が最新で履歴を根拠にしていなければ pass。台帳なし・古い・履歴の参照は fail。理由があれば skipped", () => {
    assert.equal(runRoles({ rows: [{ run_ref: "gh-run-1" }], roles, stale: false }).status, "pass");
    assert.equal(runRoles({ rows: [], roles: null, stale: false }).status, "fail");
    const stale = runRoles({ rows: [], roles, stale: true });
    assert.match(stale.messages[0], /生成結果と一致しない/);
    const history = runRoles({ rows: [{ run_ref: "gh-run-0" }], roles, stale: false });
    assert.equal(history.status, "fail");
    assert.equal(history.stats.history, 1);
    const skipped = runRoles({ skip: "構造検査のみ" });
    assert.equal(skipped.status, "skipped");
    assert.deepEqual(skipped.messages, ["構造検査のみ"]);
  });

  const REF = "./docs/evidence/runs/1/observations/backend/TC-001.json";
  const apiRow = (over = {}) => ({
    test_id: "TC-001",
    endpoint: "/api/v1/tasks",
    method: "POST",
    tags: "business",
    status: "pass",
    schema_validated: "true",
    asserts_status: "true",
    asserts_header: "false",
    asserts_content_type: "true",
    evidence_ref: REF,
    run_id: "gh-run-1",
    ...over,
  });
  const bundle = (rows, header = API_RESULT_COLUMNS) => ({
    tables: {
      "api-results": { header, rows },
      cases: { rows: [{ test_case_id: "TC-001" }] },
      "evidence-index": { rows: [{ ref: REF }] },
    },
  });

  it("api-results: 列・語彙・TC と証拠の参照・生成結果との一致を検査する。表も対応表も無ければ skipped", () => {
    assert.equal(apiResults(bundle([apiRow()]), { hasMapping: true, stale: false }).status, "pass");
    const bad = apiResults(
      bundle(
        [apiRow({ test_id: "TC-999", status: "ok", evidence_ref: "./x", asserts_header: "yes" })],
        ["a"],
      ),
      { hasMapping: true, stale: true },
    );
    const messages = bad.messages.join("\n");
    assert.equal(bad.status, "fail");
    assert.match(messages, /列が違う/);
    assert.match(messages, /TC-999: cases.csv に無い TC/);
    assert.match(messages, /status が語彙外/);
    assert.match(messages, /evidence_ref \.\/x が証拠索引に無い/);
    assert.match(messages, /asserts_header が true \/ false でない/);
    assert.match(messages, /生成結果と一致しない/);
    const noTable = { tables: { "evidence-index": { rows: [] }, cases: { rows: [] } } };
    assert.match(
      apiResults(noTable, { hasMapping: true, stale: null }).messages[0],
      /api-results.csv が無い/,
    );
    assert.equal(apiResults({ tables: {} }, { hasMapping: false, stale: null }).status, "skipped");
  });
});
