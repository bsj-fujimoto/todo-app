// node:test の --experimental-test-coverage のテキスト表 → 機械可読な JSON。
// 表の例:
//   ℹ  app.js            |  68.89 |    63.64 |   60.00 | 20-23 26-33
//   ℹ all files          |  80.52 |    68.42 |   66.10 |
// ディレクトリ行（数値が空）の字下げでパスを組み立てる。

const ROW = /^(?:ℹ\s?)?(\s*)(\S.*?)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|\s*(.*)$/;
const num = (v) => (v === "" ? null : Number(v));

function parseRow(line) {
  const m = ROW.exec(line);
  if (!m || /^-+$/.test(m[2]) || m[2] === "file") return null;
  return {
    indent: m[1].length,
    name: m[2],
    lines: num(m[3]),
    branches: num(m[4]),
    functions: num(m[5]),
    uncovered: m[6].trim(),
  };
}

export function parseCoverage(text) {
  const rows = text.split("\n").map(parseRow).filter(Boolean);
  const stack = [];
  const files = [];
  let total = null;
  for (const r of rows) {
    if (r.name === "all files") {
      total = { lines: r.lines, branches: r.branches, functions: r.functions };
    } else if (r.lines === null) {
      stack.length = r.indent;
      stack[r.indent] = r.name;
    } else {
      const path = [...stack.slice(0, r.indent), r.name].join("/");
      files.push({
        path,
        lines: r.lines,
        branches: r.branches,
        functions: r.functions,
        uncovered: r.uncovered,
      });
    }
  }
  return { total, files };
}
