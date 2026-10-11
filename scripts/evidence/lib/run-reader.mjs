// docs/evidence/runs/<run-id>/ を読む（JUnit・観察値・ci-summary・回帰選択・SOURCE.json）。ファイル入出力だけを担う。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, sha256, toPosix } from "./common.mjs";
import { parseJunitSuites } from "./junit-suites.mjs";

const readIfExists = (file) => (existsSync(file) ? readJson(file) : null);

function listFiles(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

/** junit/*.xml → ケース（source は run ディレクトリからの相対パス）。 */
export function readJunit(runDir) {
  const files = listFiles(join(runDir, "junit"))
    .filter((f) => f.endsWith(".xml"))
    .sort();
  const texts = files.map((f) => [`junit/${f}`, readFileSync(join(runDir, "junit", f))]);
  return {
    files: texts.map(([name]) => name),
    shas: new Map(texts.map(([name, buffer]) => [name, sha256(buffer)])),
    cases: texts.flatMap(([name, buffer]) => parseJunitSuites(buffer.toString("utf8"), name)),
  };
}

/** observations/<component>/*.json → component ごとの entry の配列（entry に _file と _sha を足す）。 */
export function readObservations(runDir) {
  const out = new Map();
  for (const rel of listFiles(join(runDir, "observations"))
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const [component, ...rest] = rel.split("/");
    const buffer = readFileSync(join(runDir, "observations", rel));
    const doc = JSON.parse(buffer.toString("utf8"));
    const file = toPosix(`observations/${component}/${rest.join("/")}`);
    const entries = (doc.entries ?? []).map((e) => ({
      ...e,
      _file: file,
      _sha: sha256(buffer),
      _tc: doc.test_case_id,
    }));
    out.set(component, [...(out.get(component) ?? []), ...entries]);
  }
  return out;
}

export function readRun(runDir) {
  return {
    source: readIfExists(join(runDir, "SOURCE.json")),
    summary: readIfExists(join(runDir, "ci-summary.json")),
    selection: readIfExists(join(runDir, "regression-selection.json")),
    junit: readJunit(runDir),
    observations: readObservations(runDir),
  };
}
