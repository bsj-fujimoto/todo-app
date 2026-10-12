// デプロイマーカー履歴の更新（CLI, composition root）。synthetic.yml の各実行の artifact（monitoring-results-<run_id>）から
// deployment-markers.jsonl を集め、monitoring/markers/deployment-markers.jsonl にマージする（読み取りのみ。run の一覧と artifact の取得）。
// 使い方: node scripts/monitoring/marker-history.mjs [--repo owner/name] [--out monitoring/markers] [--limit 100]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../lib/cli.mjs";
import { downloadRunMarkers, listSyntheticRuns } from "./deployment-source.mjs";
import { deploymentChanges, mergeMarkers, toJsonl, withRunInfo } from "./lib/marker-history.mjs";

const readRows = (path) =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

async function collect(repo, limit) {
  const incoming = [];
  const skipped = [];
  for (const run of await listSyntheticRuns(repo, limit)) {
    const got = await downloadRunMarkers(repo, run.databaseId);
    if (!got) skipped.push(run.databaseId);
    else for (const m of got.markers) incoming.push(withRunInfo(m, run, got.target));
  }
  return { incoming, skipped };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || process.env.GITHUB_REPOSITORY || "bsj-fujimoto/todo-app";
  const out = args.out || "monitoring/markers";
  mkdirSync(out, { recursive: true });
  const path = join(out, "deployment-markers.jsonl");
  const { incoming, skipped } = await collect(repo, Number(args.limit || 100));
  const merged = mergeMarkers(readRows(path), incoming);
  writeFileSync(path, toJsonl(merged));
  const none = skipped.join(", ") || "なし";
  console.log(
    `[marker-history] ${merged.length} 行（今回取得 ${incoming.length} 行、artifact を取れなかった run: ${none}）`,
  );
  for (const c of deploymentChanges(merged)) {
    const tag = c.release_tag || "リリースなし";
    console.log(
      `  デプロイ ${c.at} version ${c.version} commit ${c.commit_sha.slice(0, 7)} ${tag} ${c.mode} (run ${c.run_id})`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
