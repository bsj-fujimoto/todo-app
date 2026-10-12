// デプロイマーカーの取得（composition root。ファイル・gh CLI を直接扱う）。alert.mjs と marker-history.mjs が使う。
// すべて読み取り（gh run list / gh run download / gh api の GET）。権限は actions: read と contents: read。
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const NOT_RAN = new Set(["skipped", "cancelled", "startup_failure"]);
const MAX_BUFFER = 16 * 1024 * 1024;

const gh = async (args) => (await exec("gh", args, { maxBuffer: MAX_BUFFER })).stdout;

export function lastLine(text) {
  const lines = text.split("\n").filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

export function readLastMarker(path) {
  return existsSync(path) ? lastLine(readFileSync(path, "utf8")) : null;
}

// 1 つの synthetic 実行の artifact（monitoring-results-<run_id>）から、マーカーの全行と target.json の mode を読む。無ければ null
export async function downloadRunMarkers(repo, runId) {
  const dir = mkdtempSync(join(tmpdir(), `markers-${runId}-`));
  try {
    await gh([
      "run",
      "download",
      String(runId),
      "--repo",
      repo,
      "-n",
      `monitoring-results-${runId}`,
      "-D",
      dir,
    ]);
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  try {
    const mpath = join(dir, "deployment-markers.jsonl");
    if (!existsSync(mpath)) return null;
    const markers = readFileSync(mpath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const tpath = join(dir, "target.json");
    const target = existsSync(tpath) ? JSON.parse(readFileSync(tpath, "utf8")) : null;
    return { markers, target };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function listSyntheticRuns(repo, limit = 20) {
  const fields = "databaseId,createdAt,conclusion,event,status,url";
  const args = [
    "run",
    "list",
    "--repo",
    repo,
    "--workflow",
    "synthetic.yml",
    "--limit",
    String(limit),
    "--json",
    fields,
  ];
  return JSON.parse(await gh(args)).filter((r) => !NOT_RAN.has(r.conclusion));
}

// 参考: 最新リリースと main の先頭（デプロイしている版ではない。マーカーが取れないときの手がかり）
async function reference(repo) {
  const out = {};
  try {
    const r = JSON.parse(await gh(["api", `repos/${repo}/releases/latest`]));
    out.release_tag = r.tag_name;
    out.release_published_at = r.published_at;
  } catch {
    // リリースが無い
  }
  try {
    const c = JSON.parse(await gh(["api", `repos/${repo}/commits/main`]));
    out.main_head = { sha: c.sha, committed_at: c.commit.committer.date };
  } catch {
    // 取れない
  }
  return out.release_tag || out.main_head ? out : null;
}

export function makeDeploymentDeps(repo, markersPath) {
  return {
    readThisRun: () => readLastMarker(markersPath),
    listRuns: () => listSyntheticRuns(repo),
    runMarker: async (id) => {
      const got = await downloadRunMarkers(repo, id);
      if (!got || got.markers.length === 0) return null;
      const last = got.markers[got.markers.length - 1];
      return last.version ? { ...last, mode: got.target ? got.target.mode : null } : null;
    },
    reference: () => reference(repo),
  };
}
