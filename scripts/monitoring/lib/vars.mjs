// 変数展開（${name}）と最小の JSONPath。純関数。
const VAR_RE = /\$\{([A-Za-z0-9_]+)\}/g;

// 文字列・配列・オブジェクトの中の ${name} を vars の値で置き換える。文字列全体が ${name} 1 つだけのときは値の型（数値など）を保つ
export function interpolate(value, vars) {
  if (typeof value === "string") {
    const whole = /^\$\{([A-Za-z0-9_]+)\}$/.exec(value);
    if (whole && whole[1] in vars) return vars[whole[1]];
    return value.replace(VAR_RE, (m, name) => (name in vars ? String(vars[name]) : m));
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, vars));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, vars)]));
  }
  return value;
}

// 未解決の ${name} が残っているか
export function unresolved(value) {
  return JSON.stringify(value).match(VAR_RE) || [];
}

// "$.a.b[0].c" と "$.tasks.length" だけを扱う。見つからなければ undefined
export function jsonPath(doc, path) {
  if (path === "$") return doc;
  const tokens = path
    .replace(/^\$\.?/, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur = doc;
  for (const t of tokens) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[t];
  }
  return cur;
}
