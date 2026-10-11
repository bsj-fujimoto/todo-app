// レイヤー依存の検査（純粋関数）。import 文から「ファイル → ファイル」の依存を取り、
//   ① 宣言した向き（security/architecture.yaml の may_depend_on）に反する依存 ② 外部パッケージ・組み込みモジュールの許可外の利用
//   ③ 解決できない相対 import ④ どのレイヤーにも属さないファイル ⑤ ファイル間の循環
// を違反として返す。ゼロ依存（正規表現で import を拾う。動的 import・re-export も拾う）。
import { dirname, posix } from "node:path";
import { globToRegExp } from "../../ci/lib/repo-fs.mjs";

const EXTS = ["", ".js", ".mjs", "/index.js"];

/** コメントを除く（// は行頭だけ。"http://…" のような文字列中の // は残す）。 */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const IMPORT_PATTERNS = [
  /\bimport\s+(?:[\w*${}\s,]+?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

/** ソースから import / re-export / 動的 import のモジュール指定子を重複なく列挙する。 */
export function importsOf(src) {
  const text = stripComments(src);
  return [...new Set(IMPORT_PATTERNS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1])))];
}

/** 指定子を、同じ system 内のファイル / 外部 / 解決不能に分類する。files は system の root からの相対パス。 */
export function resolveImport(from, spec, files) {
  if (!spec.startsWith(".")) return { kind: "external", name: spec };
  const base = posix.normalize(posix.join(dirname(from), spec));
  const hit = EXTS.map((e) => `${base}${e}`).find((p) => files.has(p));
  return hit ? { kind: "internal", file: hit } : { kind: "unresolved", name: spec };
}

export function layerOf(file, layers) {
  return layers.find((l) => (l.paths ?? []).some((g) => globToRegExp(g).test(file)))?.id ?? null;
}

const externalAllowed = (layer, name) => (layer.allow_external ?? []).some((g) => globToRegExp(g).test(name));

/** ファイル間の循環（強連結成分。大きさ 2 以上、または自己参照）。Tarjan 法。 */
export function findCycles(graph) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];
  const visit = (v) => {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) cycles.push(popComponent(stack, onStack, v));
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return cycles.filter((c) => c.length > 1 || (graph.get(c[0]) ?? []).includes(c[0])).map((c) => c.sort());
}

function popComponent(stack, onStack, root) {
  const comp = [];
  let w;
  do {
    w = stack.pop();
    onStack.delete(w);
    comp.push(w);
  } while (w !== root);
  return comp;
}

function edgeViolations({ file, from, target, layers }) {
  const to = layerOf(target, layers);
  if (to === null || to === from.id) return { to, violations: [] };
  const ok = (from.may_depend_on ?? []).includes(to);
  return {
    to,
    violations: ok
      ? []
      : [
          {
            rule: "layer-direction",
            from: file,
            to: target,
            from_layer: from.id,
            to_layer: to,
            message: `${from.id} から ${to} への依存は宣言されていない（may_depend_on: ${(from.may_depend_on ?? []).join(", ") || "なし"}）`,
          },
        ],
  };
}

function fileFindings({ file, src, files, layers }) {
  const from = layers.find((l) => l.id === layerOf(file, layers));
  const imports = importsOf(src).map((s) => ({ spec: s, ...resolveImport(file, s, files) }));
  const out = { deps: [], edges: [], violations: [] };
  for (const imp of imports) {
    if (imp.kind === "unresolved")
      out.violations.push({
        rule: "unresolved-import",
        from: file,
        to: imp.name,
        message: `解決できない import ${imp.name}`,
      });
    else if (imp.kind === "external" && !externalAllowed(from, imp.name))
      out.violations.push({
        rule: "external-not-allowed",
        from: file,
        to: imp.name,
        from_layer: from.id,
        message: `${from.id} は ${imp.name} を使えない（allow_external: ${(from.allow_external ?? []).join(", ") || "なし"}）`,
      });
    else if (imp.kind === "internal") {
      const e = edgeViolations({ file, from, target: imp.file, layers });
      out.deps.push(imp.file);
      out.edges.push({ from_layer: from.id, to_layer: e.to });
      out.violations.push(...e.violations);
    }
  }
  return out;
}

const countEdges = (edges) => {
  const m = new Map();
  for (const e of edges.filter((x) => x.to_layer !== x.from_layer)) {
    const k = `${e.from_layer} -> ${e.to_layer}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort().map(([k, count]) => ({ edge: k, count }));
};

/** 1 つの system（backend / frontend）を検査する。sources: root からの相対パス → ソース文字列。 */
export function analyzeSystem(system, sources) {
  const files = new Set(sources.keys());
  const layers = system.layers ?? [];
  const unclassified = [...files].filter((f) => layerOf(f, layers) === null).sort();
  const classified = [...files].filter((f) => !unclassified.includes(f)).sort();
  const graph = new Map();
  const violations = unclassified.map((f) => ({
    rule: "unclassified-file",
    from: f,
    message: `${f} がどのレイヤーにも属さない（architecture.yaml の paths に追加する）`,
  }));
  const edges = [];
  for (const file of classified) {
    const r = fileFindings({ file, src: sources.get(file), files, layers });
    graph.set(file, r.deps);
    edges.push(...r.edges);
    violations.push(...r.violations);
  }
  const cycles = findCycles(graph);
  return {
    id: system.id,
    root: system.root,
    files: files.size,
    layers: layers.map((l) => ({
      id: l.id,
      may_depend_on: l.may_depend_on ?? [],
      allow_external: l.allow_external ?? [],
      files: classified.filter((f) => layerOf(f, layers) === l.id),
    })),
    layer_edges: countEdges(edges),
    violations,
    cycles,
  };
}

/** architecture.yaml 自体の検査（未知のレイヤー名への依存、重複 id）。 */
export function validateConfig(config) {
  const systems = config?.systems ?? [];
  if (systems.length === 0) return ["systems が無い"];
  return systems.flatMap((s) => {
    const ids = (s.layers ?? []).map((l) => l.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i).map((id) => `${s.id}: レイヤー ${id} が重複`);
    const unknown = (s.layers ?? []).flatMap((l) =>
      (l.may_depend_on ?? [])
        .filter((d) => !ids.includes(d))
        .map((d) => `${s.id}: ${l.id} の may_depend_on に未定義のレイヤー ${d}`),
    );
    return [...dup, ...unknown, ...(s.root ? [] : [`${s.id}: root が無い`])];
  });
}
