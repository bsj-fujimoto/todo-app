// デプロイマーカー（CLI, composition root）。health が返す version / commit と、GitHub Release のタグ・公開時刻を記録する。
//   出力: <out>/deployment-markers.jsonl に 1 行追記（at, version, commit_sha, release_tag, release_published_at, version_changed_at ほか）
//   用途: (1) リリース直後の抑制ルール（maintenance.yaml SUP-001）の起点  (2) incident Issue の deployment_ref
//         (3) 異常の開始時刻とリリースの相関分析。
// version_changed_at は、前回のマーカー（同じ <out> にあるとき）から version / commit が変わった場合だけ付ける。
// GitHub-hosted runner では実行ごとに前回のファイルが無いため付かず、リリースの公開時刻（release_published_at）が起点になる。
// 使い方: node scripts/monitoring/marker.mjs --base-url http://localhost:8080 --out monitoring/out [--repo owner/name]
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseArgs } from "../lib/cli.mjs";

const exec = promisify(execFile);

async function readHealth(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(10000) });
    const h = await res.json();
    return { version: h.version, commit_sha: h.commit, status: h.status };
  } catch (e) {
    return { version: null, commit_sha: null, status: `unreachable: ${e.message}` };
  }
}

async function readRelease(repo) {
  try {
    const { stdout } = await exec("gh", ["api", `repos/${repo}/releases/latest`]);
    const r = JSON.parse(stdout);
    return { release_tag: r.tag_name, release_published_at: r.published_at, release_url: r.html_url };
  } catch {
    return { release_tag: null, release_published_at: null, release_url: null };
  }
}

function lastMarker(path) {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

export function buildMarker(now, health, release, previous) {
  const changed =
    previous && (previous.version !== health.version || previous.commit_sha !== health.commit_sha);
  const tagVersion = release.release_tag ? String(release.release_tag).replace(/^v/, "") : null;
  return {
    at: now,
    ...health,
    ...release,
    matches_latest_release: tagVersion === null ? null : tagVersion === health.version,
    version_changed_at: changed ? now : previous ? previous.version_changed_at || null : null,
    source: "health + github release",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out || "monitoring/out";
  mkdirSync(out, { recursive: true });
  const repo = args.repo || process.env.GITHUB_REPOSITORY || "bsj-fujimoto/todo-app";
  const path = join(out, "deployment-markers.jsonl");
  const marker = buildMarker(
    new Date().toISOString(),
    await readHealth(args["base-url"] || "http://localhost:8080"),
    await readRelease(repo),
    lastMarker(path),
  );
  appendFileSync(path, `${JSON.stringify(marker)}\n`);
  console.log(
    `[marker] version=${marker.version} commit=${marker.commit_sha} release=${marker.release_tag || "なし"} changed_at=${marker.version_changed_at || "-"}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
