// Fastify の規約の機械検査（純粋関数）。Fastify 専用の lint プラグインは無いので、このリポジトリで守るべき規約のうち、
// ソースから確実に判定できるものだけを検査する。
//   FW-001 ルートと OpenAPI の対応: Fastify に登録した (メソッド, パス) が openapi.yaml にあり、openapi.yaml の operation がすべて登録されている
//   FW-002 reply の扱い: async ハンドラで reply.send() を return せずに呼ばない（応答の二重送信・未送信の原因）、
//          reply を返すハンドラが別の値も返さない
//   FW-003 アプリの土台: エラーハンドラ（setErrorHandler）・未定義ルートのハンドラ（setNotFoundHandler）・本文サイズ上限（bodyLimit）・ロガーを設定している
//   FW-004 ルート登録関数: routes/ の register*Route を app.js が import して 1 回ずつ呼ぶ（呼ばれないルートの死蔵・二重登録を防ぐ）
// 正規表現による静的な検査で、動的に組み立てたパスは扱えない（その場合は FW-001 が「解決できない」として失敗する）。

export const RULES = {
  "FW-001": "ルートと OpenAPI の対応",
  "FW-002": "reply の扱い（二重送信・未送信）",
  "FW-003": "アプリの土台（エラーハンドラ・未定義ルート・bodyLimit・ロガー）",
  "FW-004": "ルート登録関数の登録",
};

const METHODS = ["get", "post", "put", "patch", "delete"];
const ROUTE_RE = new RegExp(`\\bapp\\.(${METHODS.join("|")})\\(\\s*(["'\`])([^"'\`]+)\\2`, "g");

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** ソース 1 ファイルの app.<method>("<path>", …) → [{ method, path, start, end }]。end は次のルートの手前（最後はファイルの終わり）。 */
export function routesOf(src) {
  const text = stripComments(src);
  const found = [...text.matchAll(ROUTE_RE)].map((m) => ({
    method: m[1],
    path: m[3],
    start: m.index,
  }));
  return found.map((r, i) => ({ ...r, end: found[i + 1]?.start ?? text.length, text }));
}

/** Fastify のパス（/tasks/:id）→ OpenAPI のパス（/tasks/{id}）。 */
export const toOpenApiPath = (path) => path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

const sendWithoutReturn = (snippet) =>
  snippet
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        /\.send\(/.test(l) && !/^return\b/.test(l) && !/^\.send\(/.test(l) && !/=>\s*\S*\.send\(/.test(l),
    );

/** FW-002: ハンドラ 1 つ分のソース片。 */
export function replyProblems(route) {
  const snippet = route.text.slice(route.start, route.end);
  const label = `${route.method.toUpperCase()} ${route.path}`;
  const out = sendWithoutReturn(snippet).map(
    (l) => `${label}: reply.send() を return していない（async ハンドラは reply を return する）: ${l}`,
  );
  const lines = snippet.split("\n").map((l) => l.trim());
  const returnsReply = lines.some((l) => /\breturn\s+reply\b/.test(l));
  const returnsValue = lines.some((l) => /^return\s+(?!reply\b)[^;\s]/.test(l));
  if (returnsReply && returnsValue) out.push(`${label}: reply を返す経路と別の値を返す経路が混在している`);
  return out;
}

/** FW-001: 登録したルートと OpenAPI の operation の過不足。openapi は { paths } の形。 */
export function contractProblems(routes, openapi) {
  const declared = new Set(
    Object.entries(openapi?.paths ?? {}).flatMap(([path, ops]) =>
      Object.keys(ops)
        .filter((k) => METHODS.includes(k))
        .map((m) => `${m} ${path}`),
    ),
  );
  const registered = new Set(routes.map((r) => `${r.method} ${toOpenApiPath(r.path)}`));
  return [
    ...[...registered].filter((k) => !declared.has(k)).map((k) => `${k}: ルートはあるが openapi.yaml に無い`),
    ...[...declared]
      .filter((k) => !registered.has(k))
      .map((k) => `${k}: openapi.yaml にあるがルートが登録されていない`),
  ];
}

/** FW-003: app.js のソース。 */
export function foundationProblems(appSrc) {
  const text = stripComments(appSrc);
  return [
    !/\.setErrorHandler\(/.test(text) && "setErrorHandler が無い（エラーを契約の形式に変換する場所が無い）",
    !/\.setNotFoundHandler\(/.test(text) && "setNotFoundHandler が無い（未定義ルートが契約の形式にならない）",
    !/\bbodyLimit\b/.test(text) && "bodyLimit が無い（本文サイズの上限）",
    !/\blogger\b/.test(text) && "logger の設定が無い",
  ].filter(Boolean);
}

/** FW-004: routes/ の各ファイルの register*Route 関数が、app.js から import され、1 回ずつ呼ばれているか。 */
export function registrationProblems(routeSources, appSrc) {
  const text = stripComments(appSrc);
  return Object.entries(routeSources).flatMap(([file, src]) =>
    [...src.matchAll(/export\s+(?:async\s+)?function\s+(register\w+)\s*\(/g)].flatMap((m) => {
      const name = m[1];
      const calls = [...text.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))].length;
      const imported = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(text);
      return [
        !imported && `${file}: ${name} が app.js で import されていない`,
        calls !== 1 && `${file}: ${name} が app.js で ${calls} 回呼ばれている（1 回であるべき）`,
      ].filter(Boolean);
    }),
  );
}
