// ライセンス一覧（lock と node_modules から作る。依存ゼロ）と、SPDX 式の評価の単体テスト。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { licenseOf, readInventory } from "../security/lib/license-inventory.mjs";
import { evaluate, evaluateExpression } from "../security/lib/licenses.mjs";

const put = (root, rel, obj) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), JSON.stringify(obj));
};

describe("license-inventory", () => {
  it("license / licenses（旧形式）を SPDX 式にそろえる", () => {
    assert.equal(licenseOf({ license: "MIT" }), "MIT");
    assert.equal(licenseOf({ license: { type: "ISC" } }), "ISC");
    assert.equal(licenseOf({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }), "(MIT OR Apache-2.0)");
    assert.equal(licenseOf({}), null);
  });

  it("lock の license を優先し、無ければ node_modules の package.json、どちらも無ければ UNKNOWN。workspace 本体・link は数えない", () => {
    const root = mkdtempSync(join(tmpdir(), "inv-"));
    put(root, "package-lock.json", {
      packages: {
        "": { name: "root" },
        backend: { name: "backend" },
        "node_modules/@todo-app/backend": { link: true, resolved: "backend" },
        "node_modules/a": { version: "1.0.0", license: "MIT", dev: true },
        "node_modules/b": { version: "2.0.0" },
        "node_modules/c": { version: "3.0.0" },
        "node_modules/x/node_modules/a": { version: "1.0.0", license: "MIT" },
      },
    });
    put(root, "node_modules/b/package.json", { license: "BSD-3-Clause" });
    const inv = readInventory(root);
    assert.deepEqual(Object.keys(inv).sort(), ["a@1.0.0", "b@2.0.0", "c@3.0.0"]);
    assert.equal(inv["b@2.0.0"].licenses, "BSD-3-Clause");
    assert.equal(inv["b@2.0.0"].source, "node_modules/b/package.json");
    assert.equal(inv["c@3.0.0"].licenses, "UNKNOWN");
    assert.equal(inv["a@1.0.0"].dev, false, "実行時依存として入っている場所があれば dev ではない");
  });
});

describe("SPDX 式の評価", () => {
  const ok = (id) => ["MIT", "BSD-2-Clause"].includes(id);
  it("WITH・括弧・OR・AND を評価する。GPL を含む AND は不許可、OR の別案が許可なら許可", () => {
    assert.ok(evaluateExpression("MIT AND (BSD-2-Clause OR GPL-2.0-only)", ok));
    assert.ok(!evaluateExpression("MIT AND GPL-2.0-only", ok));
    assert.ok(!evaluateExpression("GPL-2.0-only WITH Classpath-exception-2.0", ok));
    assert.ok(!evaluateExpression("UNKNOWN", ok));
  });

  it("UNKNOWN は未許可の違反になり、期限内の例外だけが許す", () => {
    const policy = {
      allow: ["MIT"],
      deny_patterns: ["GPL-*"],
      exceptions: [{ package: "c@3.0.0", reason: "r", expires_at: "2026-12-01" }],
    };
    const entries = { "c@3.0.0": { licenses: "UNKNOWN" }, "d@1.0.0": { licenses: "UNKNOWN" } };
    assert.deepEqual(
      evaluate(entries, policy, "2026-10-11").violations.map((v) => v.package),
      ["d@1.0.0"],
    );
  });
});
