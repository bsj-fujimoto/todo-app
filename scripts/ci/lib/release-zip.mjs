// release-evidence.zip の読み書き（zip / unzip コマンドを使う。release.yml も同じ zip コマンドで作る）。
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} が失敗した（exit ${r.status}）: ${r.stderr || r.error}`);
}

export const unzipTo = (zip, dest) => run("unzip", ["-q", "-o", zip, "-d", dest]);

/** dir の中身を zip にする（dir 自身は含めない。パスは dir からの相対）。zip は絶対パスで渡す。 */
export const zipDir = (dir, zipAbs) => run("zip", ["-qr", zipAbs, "."], dir);

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );

/** dir 以下の全ファイル → Map(相対パス → Buffer)。 */
export const readTree = (dir) =>
  new Map(walk(dir).map((p) => [relative(dir, p).split(sep).join("/"), readFileSync(p)]));
