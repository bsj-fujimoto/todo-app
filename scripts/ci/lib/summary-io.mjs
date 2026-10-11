import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function listJsonFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return listJsonFiles(p);
    return p.endsWith(".json") ? [p] : [];
  });
}

/** ci-summary-*.json だけを読む（他の JSON が混ざっていても無視する）。 */
export function readSummaries(files) {
  return files
    .map((f) => JSON.parse(readFileSync(f, "utf8")))
    .filter((s) => s && s.schema_version === 1 && s.layers && s.test_cases);
}

/** `name=path`（coverage-summary.mjs の出力）→ { name: {lines, branches, functions} }。無いものは理由を残す。 */
export function readCoverageSpecs(specs) {
  const out = {};
  for (const spec of specs) {
    const [name, path] = [spec.slice(0, spec.indexOf("=")), spec.slice(spec.indexOf("=") + 1)];
    out[name] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).total : { error: `${path} が無い` };
  }
  return out;
}
