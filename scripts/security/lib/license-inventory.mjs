// 依存のライセンスの一覧を、package-lock.json と node_modules/*/package.json から作る（外部ツール・外部パッケージに依存しない）。
// 優先順: lock の license → node_modules 内の package.json の license / licenses。どちらも無ければ "UNKNOWN"（方針上は違反）。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);

/** package.json の license / licenses（旧形式: { type } や配列）を SPDX 式の文字列にそろえる。 */
export function licenseOf(pkg) {
  if (!pkg) return null;
  const one = (l) => (typeof l === "string" ? l : l?.type);
  if (pkg.license) return one(pkg.license) ?? null;
  const many = (Array.isArray(pkg.licenses) ? pkg.licenses : []).map(one).filter(Boolean);
  if (many.length === 0) return null;
  return many.length === 1 ? many[0] : `(${many.join(" OR ")})`;
}

const nameOf = (path) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);

/** lock の packages のうち、実際にインストールされる外部パッケージ（ルート・workspace 本体・link を除く）。 */
function externalPackages(lock) {
  return Object.entries(lock.packages ?? {}).filter(([path, p]) => path.includes("node_modules/") && !p.link);
}

function entryOf(root, path, p) {
  const fromLock = licenseOf({ license: p.license });
  const fromDisk = fromLock ? null : licenseOf(readJson(join(root, path, "package.json")));
  const source = (fromLock && "package-lock.json") || (fromDisk && `${path}/package.json`) || "なし";
  return {
    key: `${nameOf(path)}@${p.version}`,
    licenses: fromLock ?? fromDisk ?? "UNKNOWN",
    dev: Boolean(p.dev),
    source,
  };
}

/** → { "name@version": { licenses, dev, source } }。同じ名前@版が複数の場所にあれば、実行時依存として 1 か所でも入っていれば dev ではない。 */
export function readInventory(root) {
  const lock = readJson(join(root, "package-lock.json"));
  if (!lock) throw new Error("package-lock.json が無い");
  const out = {};
  for (const [path, p] of externalPackages(lock)) {
    const { key, ...e } = entryOf(root, path, p);
    out[key] = { ...e, dev: (out[key]?.dev ?? true) && e.dev };
  }
  return out;
}
