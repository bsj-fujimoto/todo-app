// 測定環境・再現条件の記録（CLI, composition root）。run.json に書く。
// 記録するもの: 測定機（OS・CPU・メモリ）、Docker・compose・k6 の版とイメージ digest、commit、script / 設定の sha256、開始時刻（UTC）。
// 使い方: node scripts/perf/env.mjs --run-dir <dir> --run-id <id> --profile <full|ci|quick> --project <compose project>
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseArgs, requireArg } from "../lib/cli.mjs";

const run = promisify(execFile);

const sh = async (cmd, args) => {
  try {
    return (await run(cmd, args)).stdout.trim();
  } catch (e) {
    return `unavailable: ${String(e.message).split("\n")[0]}`;
  }
};

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function hashFiles(paths) {
  return Object.fromEntries(paths.map((p) => [p, sha256(p)]));
}

function k6Files() {
  return readdirSync("perf/k6", { recursive: true })
    .filter((f) => f.endsWith(".js"))
    .sort()
    .map((f) => join("perf/k6", f));
}

function configFiles() {
  const files = [
    "perf/slo.yaml",
    "perf/workload.yaml",
    "perf/regression-threshold.yaml",
    "perf/compose.perf.yml",
    "perf/environment.yaml",
    process.env.COMPOSE_BASE || "docker-compose.yml",
  ];
  return files.filter((p) => existsSync(p));
}

async function dockerInfo() {
  const fmt = "{{.NCPU}}|{{.MemTotal}}|{{.OperatingSystem}}|{{.Architecture}}|{{.KernelVersion}}";
  const [ncpu, mem, osName, arch, kernel] = (await sh("docker", ["info", "--format", fmt])).split("|");
  return {
    server_version: await sh("docker", ["version", "--format", "{{.Server.Version}}"]),
    compose_version: await sh("docker", ["compose", "version", "--short"]),
    vm: { ncpu: Number(ncpu), mem_total_bytes: Number(mem), os: osName, arch, kernel },
  };
}

async function imagesOf(project, services) {
  const out = {};
  for (const s of services) {
    const id = await sh("docker", ["compose", "-p", project, "ps", "-q", s]);
    const image = await sh("docker", ["inspect", "--format", "{{.Image}} {{.Config.Image}}", id]);
    out[s] = { container: id.slice(0, 12), image };
  }
  return out;
}

function hostInfo() {
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    os_release: os.release(),
    arch: os.arch(),
    cpu_model: cpus[0].model,
    cpu_count: cpus.length,
    mem_total_bytes: os.totalmem(),
    node: process.version,
  };
}

function runnerInfo() {
  if (!process.env.GITHUB_ACTIONS) return { github_actions: false };
  return {
    github_actions: true,
    runner_os: process.env.RUNNER_OS,
    runner_arch: process.env.RUNNER_ARCH,
    runner_name: process.env.RUNNER_NAME,
    image_os: process.env.ImageOS,
    image_version: process.env.ImageVersion,
  };
}

async function k6Info() {
  const image = process.env.K6_IMAGE || "unknown";
  return {
    image,
    version: process.env.K6_VERSION || (await sh("docker", ["run", "--rm", image, "version"])),
  };
}

// 比較してよい環境の区分。baseline は同じ区分の run とだけ比べる（環境が違う値は比べない）
function envClass() {
  if (process.env.GITHUB_ACTIONS) {
    return `github-hosted:${process.env.ImageOS || "unknown"}:${process.env.RUNNER_ARCH || "unknown"}`;
  }
  return `local:${os.platform()}-${os.arch()}`;
}

async function collect(args) {
  const project = args.project || "todo-perf";
  const dirty = await sh("git", [
    "status",
    "--porcelain",
    "--",
    "perf",
    "scripts/perf",
    "backend",
    "frontend",
  ]);
  return {
    run_id: requireArg(args, "run-id"),
    started_at: new Date().toISOString(),
    profile: args.profile || "full",
    env_class: envClass(),
    commit_sha: await sh("git", ["rev-parse", "HEAD"]),
    dirty: dirty !== "",
    host: hostInfo(),
    docker: await dockerInfo(),
    k6: await k6Info(),
    containers: await imagesOf(project, ["backend", "frontend"]),
    script_sha256: hashFiles(k6Files()),
    config_sha256: hashFiles(configFiles()),
    runner: runnerInfo(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const record = await collect(args);
  writeFileSync(join(requireArg(args, "run-dir"), "run.json"), `${JSON.stringify(record, null, 2)}\n`);
  const k6 = record.k6.version.split("\n")[0];
  console.log(
    `[env] ${record.run_id} ${record.host.cpu_model} ${record.host.cpu_count} cores, docker ${record.docker.server_version}, ${k6}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
