// レイヤー依存の検査（scripts/security/lib/arch.mjs）の単体テスト。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeSystem,
  findCycles,
  importsOf,
  resolveImport,
  stripComments,
  validateConfig,
} from "../security/lib/arch.mjs";

const system = {
  id: "s",
  root: "src",
  layers: [
    { id: "top", paths: ["main.js"], may_depend_on: ["mid", "low"], allow_external: ["node:*"] },
    { id: "mid", paths: ["mid/**"], may_depend_on: ["low"], allow_external: [] },
    { id: "low", paths: ["low/**"], may_depend_on: [], allow_external: [] },
  ],
};
const src = (o) => new Map(Object.entries(o));

describe("import の抽出", () => {
  it("静的・re-export・動的を拾い、コメントの中は拾わない", () => {
    const text = [
      'import a from "./a.js";',
      'import { b, c } from "../b.js";',
      'import * as d from "node:fs";',
      'import "./side.js";',
      'export { e } from "./e.js";',
      'export * from "./f.js";',
      'const g = await import("./g.js");',
      '// import x from "./commented.js";',
      '/* import y from "./block.js"; */',
      'const url = "http://example.com";',
    ].join("\n");
    assert.deepEqual(
      importsOf(text).sort(),
      ["./a.js", "../b.js", "node:fs", "./side.js", "./e.js", "./f.js", "./g.js"].sort(),
    );
    assert.ok(!stripComments(text).includes("commented"));
    // 文字列の中の // はコメントではない（URL を残す）。includes ではなく正規表現で確かめる
    assert.match(stripComments(text), /const url = "http:\/\/example\.com";/);
  });

  it("相対・外部・解決不能を分ける（拡張子の省略と index.js も解決する）", () => {
    const files = new Set(["mid/a.js", "low/index.js", "low/x.js"]);
    assert.deepEqual(resolveImport("mid/a.js", "../low/x.js", files), { kind: "internal", file: "low/x.js" });
    assert.deepEqual(resolveImport("mid/a.js", "../low", files), { kind: "internal", file: "low/index.js" });
    assert.deepEqual(resolveImport("mid/a.js", "fastify", files), { kind: "external", name: "fastify" });
    assert.equal(resolveImport("mid/a.js", "./nope.js", files).kind, "unresolved");
  });
});

describe("レイヤー依存", () => {
  it("宣言どおりの依存は違反なし", () => {
    const r = analyzeSystem(
      system,
      src({
        "main.js": 'import "./mid/a.js"; import "./low/z.js"; import "node:fs";',
        "mid/a.js": 'import "../low/z.js";',
        "low/z.js": "export const z = 1;",
      }),
    );
    assert.deepEqual(r.violations, []);
    assert.deepEqual(r.cycles, []);
    assert.deepEqual(r.layer_edges, [
      { edge: "mid -> low", count: 1 },
      { edge: "top -> low", count: 1 },
      { edge: "top -> mid", count: 1 },
    ]);
  });

  it("下位から上位への依存・許可外の外部依存・未分類・解決不能を検出する", () => {
    const r = analyzeSystem(
      system,
      src({
        "main.js": "",
        "mid/a.js": 'import "../main.js"; import "fastify"; import "./gone.js";',
        "low/z.js": 'import "../mid/a.js";',
        "stray.js": "",
      }),
    );
    const rules = r.violations.map((v) => v.rule).sort();
    assert.deepEqual(rules, [
      "external-not-allowed",
      "layer-direction",
      "layer-direction",
      "unclassified-file",
      "unresolved-import",
    ]);
    assert.ok(r.violations.some((v) => v.from === "low/z.js" && v.to_layer === "mid"));
  });
});

describe("循環", () => {
  it("2 ファイル間・3 ファイル間・自己参照を検出し、一方向の連鎖は検出しない", () => {
    const g = new Map([
      ["a", ["b"]],
      ["b", ["a"]],
      ["c", ["d"]],
      ["d", ["e"]],
      ["e", ["c"]],
      ["f", ["f"]],
      ["g", ["h"]],
      ["h", []],
    ]);
    const c = findCycles(g).sort((x, y) => x[0].localeCompare(y[0]));
    assert.deepEqual(c, [["a", "b"], ["c", "d", "e"], ["f"]]);
  });

  it("同じレイヤー内の循環も違反として返す", () => {
    const r = analyzeSystem(system, src({ "low/a.js": 'import "./b.js";', "low/b.js": 'import "./a.js";' }));
    assert.deepEqual(r.cycles, [["low/a.js", "low/b.js"]]);
  });
});

describe("設定の検査", () => {
  it("未定義のレイヤーへの依存・重複・root なしを検出する", () => {
    const bad = {
      systems: [
        {
          id: "x",
          layers: [
            { id: "a", may_depend_on: ["zzz"] },
            { id: "a", may_depend_on: [] },
          ],
        },
      ],
    };
    assert.equal(validateConfig(bad).length, 3);
    assert.deepEqual(validateConfig({ systems: [system] }), []);
    assert.equal(validateConfig({}).length, 1);
  });
});
