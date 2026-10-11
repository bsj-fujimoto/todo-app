// 検出の安定 ID（fingerprint → FND-nnn の台帳）の単体テスト。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseYaml } from "../ci/lib/yaml-lite.mjs";
import {
  allocate,
  assignIds,
  provisionalId,
  renderLedger,
  validateFindingIds,
} from "../security/lib/finding-ids.mjs";

const entry = (n, fp) => ({
  id: `FND-${String(n).padStart(3, "0")}`,
  fingerprint: fp,
  first_seen: "2026-10-11",
  tool: "trivy",
  rule_id: "CVE-1",
  location: "x",
});
const f = (fp, extra = {}) => ({ fingerprint: fp, tool: "trivy", rule_id: "CVE-1", location: "x", ...extra });

describe("finding-ids", () => {
  it("同じ fingerprint は、検出の並び順や増減が変わっても同じ ID になる", () => {
    const ledger = [entry(1, "aaaaaaaaaaaaaaaa"), entry(2, "bbbbbbbbbbbbbbbb")];
    const a = assignIds([f("aaaaaaaaaaaaaaaa"), f("bbbbbbbbbbbbbbbb")], ledger).findings.map(
      (x) => x.finding_id,
    );
    const b = assignIds([f("bbbbbbbbbbbbbbbb")], ledger).findings.map((x) => x.finding_id);
    assert.deepEqual(a, ["FND-001", "FND-002"]);
    assert.deepEqual(b, ["FND-002"]);
  });

  it("台帳に無い検出は仮 ID にして、未登録として返す", () => {
    const { findings, unregistered } = assignIds([f("cccccccccccccccc")], [entry(1, "aaaaaaaaaaaaaaaa")]);
    assert.equal(findings[0].finding_id, provisionalId("cccccccccccccccc"));
    assert.match(findings[0].finding_id, /^FND-NEW-cccccc$/);
    assert.deepEqual(unregistered, ["cccccccccccccccc"]);
  });

  it("新しい番号は最大値の次から振り、既存の番号は変えず、解消した検出の番号も再利用しない", () => {
    const ledger = [entry(1, "aaaaaaaaaaaaaaaa"), entry(5, "bbbbbbbbbbbbbbbb")];
    const added = allocate(
      ledger,
      [f("bbbbbbbbbbbbbbbb"), f("cccccccccccccccc"), f("cccccccccccccccc"), f("dddddddddddddddd")],
      "2026-10-12",
    );
    assert.deepEqual(
      added.map((a) => [a.id, a.fingerprint]),
      [
        ["FND-006", "cccccccccccccccc"],
        ["FND-007", "dddddddddddddddd"],
      ],
    );
  });

  it("台帳の検証: 形式・重複を検出する", () => {
    assert.deepEqual(validateFindingIds([entry(1, "a"), entry(2, "b")]), []);
    assert.equal(validateFindingIds([entry(1, "a"), entry(1, "b")]).length, 1);
    assert.equal(validateFindingIds([entry(1, "a"), entry(2, "a")]).length, 1);
    assert.equal(validateFindingIds([{ ...entry(1, "a"), id: "F-1" }]).length, 1);
  });

  it("台帳の出力は yaml-lite で読み戻せる（数字だけの fingerprint も文字列のまま）", () => {
    const text = renderLedger([entry(1, "1234567890123456"), { ...entry(2, "abc"), location: 'a "q" b' }]);
    const back = parseYaml(text).ids;
    assert.equal(back[0].fingerprint, "1234567890123456");
    assert.equal(back[1].id, "FND-002");
  });
});
