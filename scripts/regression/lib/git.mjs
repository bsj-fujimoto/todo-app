// git の読み取り専用コマンドの薄いラッパ。
import { execFileSync } from "node:child_process";

const run = (root, args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const lines = (text) => text.split("\n").filter(Boolean);

/** `git diff --name-only <base>...<head>`（マージベースからの変更）。 */
export const changedFiles = (root, base, head = "HEAD") =>
  lines(run(root, ["diff", "--name-only", `${base}...${head}`]));

export const trackedFiles = (root) => lines(run(root, ["ls-files"]));
