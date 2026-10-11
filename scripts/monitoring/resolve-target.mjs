// 監視対象の決定（CLI, composition root）。最新の GitHub Release のタグから GHCR のイメージ digest を引き、compose の上書きを書く。
// リリースが無い・イメージが引けないときは docker compose up --build（main の HEAD）にフォールバックし、理由を target.json に書く。
//   出力: <out>/target.json、<out>/compose.release.yml（release のとき）、$GITHUB_OUTPUT（mode, compose_files）
// 使い方: node scripts/monitoring/resolve-target.mjs --out monitoring/out [--repo owner/name] [--force-fallback]
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { parseArgs } from "../lib/cli.mjs";
import { fallbackTarget, pinnedRef, releaseTarget, renderComposeOverride } from "./lib/target.mjs";

const exec = promisify(execFile);
const tryRun = async (cmd, args) => {
  try {
    return { ok: true, out: (await exec(cmd, args)).stdout.trim() };
  } catch (e) {
    return {
      ok: false,
      out: String(e.stderr || e.message)
        .trim()
        .split("\n")[0],
    };
  }
};

async function latestRelease(repo) {
  const r = await tryRun("gh", ["api", `repos/${repo}/releases/latest`]);
  return r.ok ? { release: JSON.parse(r.out) } : { error: `最新リリースを取得できない: ${r.out}` };
}

async function tagCommit(repo, tag) {
  const ref = await tryRun("gh", [
    "api",
    `repos/${repo}/git/ref/tags/${tag}`,
    "--jq",
    '.object.type + " " + .object.sha',
  ]);
  if (!ref.ok) return "";
  const [type, sha] = ref.out.split(" ");
  if (type === "commit") return sha;
  const tagObj = await tryRun("gh", ["api", `repos/${repo}/git/tags/${sha}`, "--jq", ".object.sha"]);
  return tagObj.ok ? tagObj.out : "";
}

async function digestOf(image, tag) {
  const r = await tryRun("docker", [
    "buildx",
    "imagetools",
    "inspect",
    `${image}:${tag}`,
    "--format",
    "{{json .Manifest.Digest}}",
  ]);
  return r.ok ? JSON.parse(r.out) : null;
}

async function resolveImages(cfg, tag) {
  const images = {};
  for (const [service, image] of Object.entries(cfg.images)) {
    const digest = await digestOf(image, tag);
    if (!digest) return { error: `GHCR からイメージを引けない: ${image}:${tag}` };
    images[service] = pinnedRef(image, digest);
  }
  return { images };
}

async function headCommit() {
  return (await tryRun("git", ["rev-parse", "HEAD"])).out;
}

async function decide(cfg, repo, forceFallback) {
  const commit = await headCommit();
  if (forceFallback) return fallbackTarget({ reason: "--force-fallback の指定", commit });
  const { release, error } = await latestRelease(repo);
  if (error) return fallbackTarget({ reason: `${error}（リリースがまだ無い可能性）`, commit });
  const resolved = await resolveImages(cfg, release.tag_name);
  if (resolved.error)
    return fallbackTarget({ reason: `リリース ${release.tag_name} はあるが、${resolved.error}`, commit });
  return releaseTarget({ release, images: resolved.images, commit: await tagCommit(repo, release.tag_name) });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out || "monitoring/out";
  mkdirSync(out, { recursive: true });
  const cfg = parse(readFileSync("monitoring/target.yaml", "utf8"));
  const target = await decide(
    cfg,
    args.repo || process.env.GITHUB_REPOSITORY || cfg.repository,
    Boolean(args["force-fallback"]),
  );
  const files = ["docker-compose.yml"];
  if (target.mode === "release") {
    writeFileSync(join(out, "compose.release.yml"), renderComposeOverride(target.images));
    files.push(join(out, "compose.release.yml"));
  }
  target.compose_files = files;
  writeFileSync(join(out, "target.json"), `${JSON.stringify(target, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${target.mode}\ncompose_files=${files.join(" ")}\n`);
  console.log(`[target] mode=${target.mode} ${target.reason}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
