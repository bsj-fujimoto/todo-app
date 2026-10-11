// 依存マニフェストの照合の入口（ファイルを読んで manifests.mjs の純粋関数に渡す）。
// files: 追跡ファイルの一覧（CLI が trackedFiles で作る）。無ければ（テストなど）照合はしない。
import { isFile, readText } from "../../ci/lib/repo-fs.mjs";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";
import { dependabotProblems, selectionProblems } from "./manifests.mjs";

const COMPOSE = /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
const DOCKERFILE = /(^|\/)Dockerfile(\..+)?$/;

const readAll = (root, files) => Object.fromEntries(files.map((f) => [f, readText(root, f)]));

export function manifestPolicyProblems(root, files) {
  if (!files) return [];
  const dependabot = ".github/dependabot.yml";
  const selection = "security/dependency-selection.yaml";
  const packages = Object.fromEntries(
    files.filter((f) => /(^|\/)package\.json$/.test(f)).map((f) => [f, JSON.parse(readText(root, f))]),
  );
  const dockerfiles = readAll(
    root,
    files.filter((f) => DOCKERFILE.test(f) || COMPOSE.test(f)),
  );
  const out = [];
  if (isFile(root, dependabot)) out.push(...dependabotProblems(parseYaml(readText(root, dependabot)), files));
  else out.push(`${dependabot} が無い`);
  if (isFile(root, selection)) {
    const entries = (parseYaml(readText(root, selection)) ?? {}).dependencies ?? [];
    out.push(...selectionProblems({ entries, packages, dockerfiles }));
  }
  return out;
}
