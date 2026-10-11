// リポジトリ内のファイル走査（依存ゼロ）。node_modules・.git・成果物ディレクトリは歩かない。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
]);

export function walkFiles(root, dir = ".", filter = () => true) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = join(dir, e.name);
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walkFiles(root, rel, filter);
    return filter(rel) ? [rel.replaceAll("\\", "/")] : [];
  });
}

export const readText = (root, rel) => readFileSync(join(root, rel), "utf8");
export const exists = (root, rel) => existsSync(join(root, rel));
export const isFile = (root, rel) => statSync(join(root, rel), { throwIfNoEntry: false })?.isFile() ?? false;
export const relFrom = (root, abs) => relative(root, abs).replaceAll("\\", "/");

/** パスが glob（`**` `*` `?`）に一致するか。パスは `/` 区切りに正規化して比較する。 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export const matchesGlob = (path, glob) => globToRegExp(glob).test(path);
