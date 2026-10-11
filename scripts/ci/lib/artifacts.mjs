// artifact の実体（ファイル数・サイズ・sha256）を記録する。存在しないものは exists:false で残す（隠さない）。
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const sha256Of = (buf) => createHash("sha256").update(buf).digest("hex");

function walk(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return [path];
  return readdirSync(path).flatMap((n) => walk(join(path, n)));
}

export function describeArtifact(spec) {
  const eq = spec.indexOf("=");
  const name = spec.slice(0, eq);
  const path = spec.slice(eq + 1);
  const st = statSync(path, { throwIfNoEntry: false });
  if (!st) return { name, path, exists: false };
  if (!st.isDirectory()) {
    return { name, path, exists: true, files: 1, bytes: st.size, sha256: sha256Of(readFileSync(path)) };
  }
  const files = walk(path);
  const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
  return { name, path, exists: true, files: files.length, bytes };
}
