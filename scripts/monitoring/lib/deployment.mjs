// incident の「直前のデプロイ（deployment_ref）」を、実際のデプロイマーカーから作る。
// マーカー = marker.mjs が記録する、動かしているイメージ / commit の version・commit_sha・観測時刻（health の値）と、GitHub Release のタグ・公開時刻。
//   - 監視の実行がアプリを起動していれば、その run のマーカー（deployment-markers.jsonl の最後の行）を使う。
//   - アプリを起動していない実行（watchdog・実行基盤の失敗の meta-alert）は、直近の synthetic 実行のマーカーを使う（取れた run を明記）。
//   - どちらも取れないときは「取れない: 理由」を書く。作り話（推測値）は書かない。参考として、取れた範囲の最新リリースと main の先頭を並べる。
// 純関数（describeDeployment）と、入出力を注入された関数で受ける解決（resolveDeployment）。

const MODE_LABEL = {
  release: "リリースのイメージ（digest 固定）",
  fallback: "fallback（main の先頭をビルド。commit は main の先頭）",
};

function releasePart(marker) {
  if (!marker || !marker.release_tag) return "最新リリースなし";
  return `最新リリース ${marker.release_tag}（公開 ${marker.release_published_at || "時刻不明"}）`;
}

function referencePart(reference) {
  if (!reference) return "";
  const parts = [];
  if (reference.release_tag)
    parts.push(
      `最新リリース ${reference.release_tag}（公開 ${reference.release_published_at || "時刻不明"}）`,
    );
  if (reference.main_head)
    parts.push(`main の先頭 ${reference.main_head.sha}（${reference.main_head.committed_at}）`);
  return parts.length ? `。参考（デプロイしている版ではない）: ${parts.join("、")}` : "";
}

function modeOf(marker, run, source) {
  const key = source && source.kind === "last-synthetic-run" ? marker.mode : run && run.mode;
  return MODE_LABEL[key] || key || "対象の種別不明";
}

function originOf(source) {
  if (!source || source.kind !== "last-synthetic-run") return "";
  return `この実行はアプリを起動していないため、直近の synthetic 実行（run ${source.run_id}、${source.created_at}）のマーカー: `;
}

function measured({ marker, run, source }) {
  const head = `version ${marker.version}、commit ${marker.commit_sha}（health の観測 ${marker.at}）`;
  return `${originOf(source)}${head}、対象 ${modeOf(marker, run, source)}、${releasePart(marker)}`;
}

function unavailable({ marker, reason, reference }) {
  const why = marker
    ? `health に到達できず version・commit を読めなかった（${marker.status}）`
    : reason || "デプロイマーカーを記録した実行が無い";
  return `取れない: ${why}${referencePart(reference || marker)}`;
}

// source: { kind: "this-run" | "last-synthetic-run", run_id, created_at }。run: { mode }
export function describeDeployment(input) {
  return input.marker && input.marker.version ? measured(input) : unavailable(input);
}

// 直近の synthetic 実行（ran: skipped・cancelled 以外）のうち、マーカーが取れた最新の 1 件
export async function markerFromLastRun(deps, maxTries = 5) {
  const runs = await deps.listRuns();
  const tried = [];
  for (const r of runs.slice(0, maxTries)) {
    const marker = await deps.runMarker(r.databaseId);
    if (marker)
      return {
        marker,
        source: { kind: "last-synthetic-run", run_id: r.databaseId, created_at: r.createdAt },
      };
    tried.push(r.databaseId);
  }
  return {
    marker: null,
    reason: `直近の synthetic 実行（${tried.join("、") || "なし"}）からマーカーを取れなかった（artifact が無い・期限切れ・権限）`,
  };
}

// deps: { readThisRun(): marker|null, listRuns(), runMarker(id), reference() }。すべて失敗しうる入出力
export async function resolveDeployment(deps, { fromLastRun }) {
  const own = deps.readThisRun();
  if (own) return { marker: own, source: { kind: "this-run" }, reference: null, reason: null };
  if (!fromLastRun) {
    return {
      marker: null,
      source: null,
      reference: await safe(deps.reference),
      reason: "この実行にデプロイマーカーの記録が無い（marker.mjs の前に失敗した）",
    };
  }
  const last = await safe(() => markerFromLastRun(deps));
  if (last && last.marker) return { ...last, reference: null };
  const why = last ? last.reason : "直近の synthetic 実行を取得できなかった（gh api の失敗）";
  return { marker: null, source: null, reference: await safe(deps.reference), reason: why };
}

async function safe(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}
