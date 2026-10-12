// デプロイマーカー履歴（monitoring/markers/deployment-markers.jsonl）の組み立て。純関数。
// 履歴 = 各 synthetic 実行のマーカー（health の version・commit_sha・観測時刻 at）に、実行の情報（run_id・event・対象 mode）を足したもの。
// artifact は 90 日で消えるので、既存のファイルの行は残し、新しく取れた行を足す（同じ run の同じ観測は 1 行）。

const keyOf = (m) => `${m.run_id}|${m.at}`;

export function withRunInfo(marker, run, target) {
  return {
    at: marker.at,
    version: marker.version,
    commit_sha: marker.commit_sha,
    status: marker.status,
    release_tag: marker.release_tag,
    release_published_at: marker.release_published_at,
    matches_latest_release: marker.matches_latest_release,
    mode: target ? target.mode : null,
    run_id: run.databaseId,
    run_event: run.event,
    run_url: run.url,
  };
}

export function mergeMarkers(existing, incoming) {
  const byKey = new Map(existing.map((m) => [keyOf(m), m]));
  for (const m of incoming) byKey.set(keyOf(m), m);
  return [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at));
}

// 動かしている版（version・commit・リリースのタグ・対象の種別）が変わった点 = デプロイ（監視が観測した範囲）。最初の観測も 1 件とする
export function deploymentChanges(markers) {
  const out = [];
  let prev = null;
  for (const m of markers.filter((x) => x.version)) {
    const sig = `${m.version}|${m.commit_sha}|${m.release_tag || ""}|${m.mode || ""}`;
    if (sig !== prev) {
      out.push({
        at: m.at,
        version: m.version,
        commit_sha: m.commit_sha,
        release_tag: m.release_tag,
        mode: m.mode,
        run_id: m.run_id,
      });
    }
    prev = sig;
  }
  return out;
}

export const toJsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
