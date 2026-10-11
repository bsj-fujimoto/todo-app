import { readFileSync, readdirSync, statSync } from "node:fs";
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
