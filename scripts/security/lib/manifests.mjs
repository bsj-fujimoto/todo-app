// リポジトリの依存マニフェスト（package.json・Dockerfile・compose・composite action）を追跡ファイルから列挙し、
//   ① Dependabot（.github/dependabot.yml）が全部を覆っているか
//   ② 依存の選定記録（security/dependency-selection.yaml）が、実際の依存・ベースイメージと一致しているか
// を機械で照合する（純粋関数。ファイルの読み込みは呼び出し側）。漏れ・古い記載・存在しない依存は失敗にする。
import { dirname, basename } from "node:path";

const COMPOSE = /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
const DEP_KEYS = ["dependencies", "devDependencies", "optionalDependencies"];
const NON_NPM_KINDS = new Set(["base-image", "builtin", "internal"]);

const dirOf = (file) => {
  const d = dirname(file);
  return d === "." ? "/" : `/${d}`;
};

/** 追跡ファイルの一覧 → 種類ごとのマニフェストのディレクトリ。 */
export function manifestDirs(files) {
  const pick = (test) => [...new Set(files.filter(test).map(dirOf))].sort();
  return {
    npm: pick((f) => basename(f) === "package.json"),
    docker: pick((f) => /^Dockerfile(\..+)?$/.test(basename(f))),
    compose: pick((f) => COMPOSE.test(basename(f))),
    actions: pick((f) => /^\.github\/actions\/[^/]+\/action\.ya?ml$/.test(f)),
  };
}

const dirsOf = (updates, ecosystem) =>
  updates
    .filter((u) => u["package-ecosystem"] === ecosystem)
    .flatMap((u) => [...(u.directories ?? []), ...(u.directory ? [u.directory] : [])]);

const missing = (need, have, label) =>
  need
    .filter((d) => !have.includes(d))
    .map((d) => `dependabot.yml: ${label} の ${d} が覆われていない（マニフェストがあるのに updates に無い）`);
const stale = (need, have, label) =>
  have
    .filter((d) => !need.includes(d))
    .map((d) => `dependabot.yml: ${label} の ${d} にマニフェストが無い（古い記載）`);

/** Dependabot が全マニフェストを覆い、存在しないディレクトリを指していないか。 */
export function dependabotProblems(config, files) {
  const updates = config?.updates ?? [];
  const need = manifestDirs(files);
  const have = {
    npm: dirsOf(updates, "npm"),
    docker: dirsOf(updates, "docker"),
    compose: dirsOf(updates, "docker-compose"),
    actions: dirsOf(updates, "github-actions").filter((d) => d !== "/"),
  };
  const hasWorkflows = files.some((f) => f.startsWith(".github/workflows/"));
  const wfs =
    hasWorkflows && !dirsOf(updates, "github-actions").includes("/")
      ? ["dependabot.yml: github-actions の / が無い（.github/workflows を覆っていない）"]
      : [];
  return [
    ...missing(need.npm, have.npm, "npm"),
    ...missing(need.docker, have.docker, "docker"),
    ...missing(need.compose, have.compose, "docker-compose"),
    ...missing(need.actions, have.actions, "github-actions"),
    ...stale(need.npm, have.npm, "npm"),
    ...stale(need.docker, have.docker, "docker"),
    ...stale(need.compose, have.compose, "docker-compose"),
    ...stale(need.actions, have.actions, "github-actions"),
    ...wfs,
  ];
}

// ---- 依存の選定記録 ------------------------------------------------------------------------

/** package.json（ファイル名 → 内容）→ [{ name, version, file }]。workspace 本体（private で名前が todo-app 系）の自己参照は含まない。 */
export function npmDependencies(packages) {
  return Object.entries(packages).flatMap(([file, pkg]) =>
    DEP_KEYS.flatMap((k) =>
      Object.entries(pkg[k] ?? {}).map(([name, version]) => ({ name, version: String(version), file })),
    ),
  );
}

/** Dockerfile / compose の外部イメージ参照。FROM の段名（AS）参照と scratch は除く。 */
export function imageRefs(text, file) {
  const stages = new Set();
  const out = [];
  for (const line of text.split("\n")) {
    const m = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (m) {
      if (m[1] !== "scratch" && !stages.has(m[1])) out.push(parseImage(m[1], file));
      if (m[2]) stages.add(m[2]);
      continue;
    }
    const c = /^\s*image:\s*["']?([^\s"'#]+)/.exec(line);
    if (c && !c[1].includes("${")) out.push(parseImage(c[1], file));
  }
  return out;
}

export function parseImage(ref, file) {
  const [nameTag, digest = null] = ref.split("@");
  const slash = nameTag.lastIndexOf("/");
  const colon = nameTag.indexOf(":", slash + 1);
  return {
    ref,
    repository: colon < 0 ? nameTag : nameTag.slice(0, colon),
    tag: colon < 0 ? null : nameTag.slice(colon + 1),
    digest,
    file,
  };
}

const text = (v) => String(v ?? "");

function npmEntryProblems(dep, entries) {
  const byName = entries.filter((e) => !NON_NPM_KINDS.has(e.kind) && e.name === dep.name);
  if (byName.length === 0) return [`dependency-selection.yaml: ${dep.name}（${dep.file}）の選定記録が無い`];
  const versions = byName.map((e) => text(e.version));
  return versions.includes(dep.version)
    ? []
    : [
        `dependency-selection.yaml: ${dep.name} の版が古い（記録 ${versions.join("/")}、実際 ${dep.version}。${dep.file}）`,
      ];
}

function imageEntryProblems(img, entries) {
  const bases = entries.filter((e) => e.kind === "base-image");
  if (!img.digest) return [`${img.file}: ${img.ref} が digest で固定されていない（tag@sha256:… にする）`];
  if (bases.some((e) => text(e.version).includes(img.digest))) return [];
  const sameRepo = bases.filter((e) => text(e.name).includes(img.repository));
  if (sameRepo.length === 0)
    return [`dependency-selection.yaml: ${img.repository}（${img.file}）のベースイメージの選定記録が無い`];
  return [
    `dependency-selection.yaml: ${img.repository} の記載が古い（digest が違う。実際 ${img.digest.slice(0, 19)}…、${img.file}）`,
  ];
}

function staleEntryProblems(entries, deps, images) {
  const names = new Set(deps.map((d) => d.name));
  return entries.flatMap((e) => {
    if (e.kind === "base-image")
      return images.some((i) => text(e.version).includes(i.digest ?? "—"))
        ? []
        : [`dependency-selection.yaml: ${e.name} のベースイメージはどの Dockerfile にも無い（古い記載）`];
    if (NON_NPM_KINDS.has(e.kind)) return [];
    return names.has(e.name)
      ? []
      : [`dependency-selection.yaml: ${e.name} はどの package.json にも無い（古い記載）`];
  });
}

/** Playwright のイメージの版は、playwright-core / @playwright/test の版と同じ（ずれるとブラウザが合わない）。 */
function playwrightCoupling(deps, images) {
  const img = images.find((i) => i.repository === "mcr.microsoft.com/playwright");
  const core = deps.find((d) => d.name === "playwright-core");
  if (!img || !core) return [];
  return img.tag?.startsWith(`v${core.version}`)
    ? []
    : [`${img.file}: Playwright のイメージの版（${img.tag}）が playwright-core ${core.version} と違う`];
}

export function selectionProblems({ entries, packages, dockerfiles }) {
  const deps = npmDependencies(packages);
  const images = Object.entries(dockerfiles).flatMap(([file, body]) => imageRefs(body, file));
  const uniqueDeps = [...new Map(deps.map((d) => [`${d.name}@${d.version}`, d])).values()];
  const workspaceSelf = (d) => /^@todo-app\//.test(d.name);
  return [
    ...uniqueDeps.filter((d) => !workspaceSelf(d)).flatMap((d) => npmEntryProblems(d, entries)),
    ...images.flatMap((i) => imageEntryProblems(i, entries)),
    ...staleEntryProblems(entries, deps, images),
    ...playwrightCoupling(deps, images),
  ];
}
