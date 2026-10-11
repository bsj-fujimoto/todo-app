// security-results/<scan>/ を歩いて、scan-run.json と検査の出力（SARIF / npm audit JSON）から Finding を集める。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { findingsFromNpmAudit, findingsFromSarif, readJson } from "./findings.mjs";

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const isNpmAudit = (path) => /npm-audit.*\.json$/.test(basename(path));

const fromFile = (p, meta) => {
  if (p.endsWith(".sarif")) return findingsFromSarif(readJson(p), meta);
  return isNpmAudit(p) ? findingsFromNpmAudit(readJson(p), meta) : [];
};

function findingsOf(dir, files, meta) {
  return files.flatMap((p) =>
    fromFile(p, meta).map((f) => ({ ...f, scan_dir: dir, source_file: basename(p) })),
  );
}

/** root 以下の scan-run.json を全部読み、検査ごとに { run, findings } を返す。 */
export function collectScans(root) {
  const runs = walk(root).filter((p) => basename(p) === "scan-run.json");
  return runs.map((p) => {
    const run = JSON.parse(readFileSync(p, "utf8"));
    const dir = dirname(p);
    const files = walk(dir).filter((f) => f !== p);
    const meta = {
      scan: run.scan,
      check_kind: run.check_kind,
      tool: run.tool?.name,
      image: run.coverage?.images?.[0] ?? null,
    };
    return { run, findings: run.status === "ok" && !run.informational ? findingsOf(dir, files, meta) : [] };
  });
}

/** 期待した検査のうち、実行記録が無い・ok でないもの（skipped は理由を添えて別扱い）。 */
export function missingScans(expected, runs) {
  const byName = new Map(runs.map((r) => [r.scan, r]));
  return expected.flatMap((e) => {
    const r = byName.get(e.name);
    if (!r) return [`${e.name}（実行記録が無い）`];
    if (r.status === "skipped") return [`${e.name}（スキップ: ${r.skipped_reason ?? "理由なし"}）`];
    return r.status === "ok" ? [] : [`${e.name}（${r.status}）`];
  });
}
