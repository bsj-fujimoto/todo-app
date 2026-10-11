// 検査 1 回分の記録（scan-run.json）を組み立て、SARIF に「対象・版・実行日時・コマンド」を書き込む。
// 目的: SARIF 単体を後から読んでも、どのリポジトリのどの commit を、いつ、どのコマンドで検査したかが分かる。
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function outputFiles(dir) {
  const walk = (d) =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return walk(dir)
    .filter((p) => !p.endsWith("scan-run.json"))
    .sort()
    .map((p) => ({
      path: relative(process.cwd(), p),
      bytes: statSync(p).size,
      sha256: sha256(readFileSync(p)),
    }));
}

const isSarif = (doc) => doc && Array.isArray(doc.runs) && typeof doc.version === "string";
const tryJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

const driverOf = (run) =>
  run.tool?.driver
    ? {
        name: run.tool.driver.name,
        version: run.tool.driver.semanticVersion ?? run.tool.driver.version ?? null,
      }
    : null;

export function sarifInfo(files) {
  const runs = files
    .filter((x) => x.path.endsWith(".sarif"))
    .map((f) => tryJson(f.path))
    .filter(isSarif)
    .flatMap((doc) => doc.runs);
  return {
    results: runs.reduce((n, r) => n + (r.results ?? []).length, 0),
    tool: runs.map(driverOf).find(Boolean) ?? null,
  };
}

function ensureInvocation(r, run) {
  if (!r.invocations?.length) r.invocations = [{ executionSuccessful: run.exit_ok }];
  const inv = r.invocations[0];
  inv.startTimeUtc ??= run.started_at;
  inv.endTimeUtc ??= run.finished_at;
  inv.commandLine ??= run.command;
}

/** SARIF の各 run に、版管理の出自（repositoryUri / revisionId / branch）と実行情報を追記する。既にある値は壊さない。 */
export function annotateSarif(doc, run) {
  for (const r of doc.runs) {
    if (!r.versionControlProvenance?.length) {
      const { repository, commit_sha, branch } = run.target;
      r.versionControlProvenance = [{ repositoryUri: repository, revisionId: commit_sha, branch }];
    }
    ensureInvocation(r, run);
    const props = {
      scan: run.scan,
      image_digest: run.target.image_digest ?? null,
      config_ref: run.config_ref ?? null,
    };
    r.properties = { ...r.properties, ...props };
  }
  return doc;
}

export function annotateFiles(files, run) {
  for (const f of files.filter((x) => x.path.endsWith(".sarif"))) {
    const doc = tryJson(f.path);
    if (isSarif(doc)) writeFileSync(f.path, `${JSON.stringify(annotateSarif(doc, run), null, 2)}\n`);
  }
}
