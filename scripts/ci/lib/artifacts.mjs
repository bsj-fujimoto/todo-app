// artifact の実体（ファイル数・サイズ・sha256）を記録する。存在しないものは exists:false で残す（隠さない）。
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const sha256Of = (buf) => createHash("sha256").update(buf).digest("hex");

function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)],
  );
}

// 存在確認（stat）と読み取りを分けない（確認後にファイルが変わる競合を避ける）。ファイルとして読めればそれ、ディレクトリなら中を数える。
export function describeArtifact(spec) {
  const eq = spec.indexOf("=");
  const name = spec.slice(0, eq);
  const path = spec.slice(eq + 1);
  try {
    const buf = readFileSync(path);
    return { name, path, exists: true, files: 1, bytes: buf.length, sha256: sha256Of(buf) };
  } catch (e) {
    if (e.code === "ENOENT") return { name, path, exists: false };
    if (e.code !== "EISDIR") throw e;
  }
  const files = walk(path);
  return {
    name,
    path,
    exists: true,
    files: files.length,
    bytes: files.reduce((n, f) => n + statSync(f).size, 0),
  };
}
