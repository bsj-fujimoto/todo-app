// incident の台帳（monitoring/incidents.csv）と drill の台帳（monitoring/drill-issues.csv）の検査。純関数。
// 台帳は incident ごとに「直前のデプロイ（実際のデプロイマーカー）」「真因が入った変更」「還流先（defect・test・monitor・runbook）」を持つ。
// 検査: 必須列、直前のデプロイが実在のマーカー（monitoring/markers/deployment-markers.jsonl）と対応、取れないなら理由、真因の記録。

// RFC 4180 の範囲（引用符・引用符内の改行とカンマ・"" のエスケープ）。1 行目を見出しにして、行をオブジェクトの配列で返す
export function parseCsv(text) {
  const re = /("(?:[^"]|"")*"|[^,\n]*)(,|\n|$)/gy;
  const rows = [];
  let row = [];
  let m = re.exec(text);
  while (m && re.lastIndex <= text.length) {
    row.push(m[1].startsWith('"') ? m[1].slice(1, -1).replace(/""/g, '"') : m[1]);
    if (m[2] !== ",") {
      rows.push(row);
      row = [];
    }
    m = re.lastIndex < text.length ? re.exec(text) : null;
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export const INCIDENT_REQUIRED = [
  "incident_id",
  "started_at",
  "detected_by",
  "deployment_ref",
  "deployment_ref_source",
  "deployment_is_root_cause",
  "root_cause_at",
  "root_cause_ref",
];
export const DRILL_REQUIRED = [
  "issue_number",
  "opened_at",
  "environment",
  "monitors",
  "result",
  "record",
  "feedback",
];

const blank = (v) => v === undefined || v === null || String(v).trim() === "";

function checkDeploymentRef(r, markerTimes) {
  const ref = r.deployment_ref || "";
  if (/^不明/.test(ref))
    return [`${r.incident_id}: deployment_ref が「不明」（取れないなら「取れない: 理由」と書く）`];
  if (ref.startsWith("取れない")) return [];
  const problems = [];
  if (!ref.startsWith("version "))
    problems.push(`${r.incident_id}: deployment_ref が「version …」でも「取れない: 理由」でもない`);
  if (blank(r.deployment_marker_at) || !markerTimes.has(r.deployment_marker_at))
    problems.push(
      `${r.incident_id}: deployment_marker_at ${r.deployment_marker_at || "（空）"} が markers/deployment-markers.jsonl に無い`,
    );
  return problems;
}

function checkRow(r, markerTimes) {
  const missing = INCIDENT_REQUIRED.filter((c) => blank(r[c])).map(
    (c) => `${r.incident_id || "(id なし)"}: ${c} が空`,
  );
  return [...missing, ...(blank(r.deployment_ref) ? [] : checkDeploymentRef(r, markerTimes))];
}

// JSONL の各行の at。読めない行は無視する（その場合、台帳の deployment_marker_at が「履歴に無い」と検出される）
function markerTimesOf(jsonl) {
  const times = new Set();
  for (const line of (jsonl || "").split("\n").filter(Boolean)) {
    try {
      times.add(JSON.parse(line).at);
    } catch {
      // 読めない行
    }
  }
  return times;
}

function checkDrills(csv) {
  return parseCsv(csv).flatMap((d) =>
    DRILL_REQUIRED.filter((c) => blank(d[c])).map(
      (c) => `incidents: drill #${d.issue_number || "?"}: ${c} が空`,
    ),
  );
}

export function checkIncidents({ incidentsCsv, drillCsv, markersJsonl }) {
  if (incidentsCsv === null) return ["incidents: monitoring/incidents.csv が無い"];
  if (drillCsv === null) return ["incidents: monitoring/drill-issues.csv が無い"];
  const markerTimes = markerTimesOf(markersJsonl);
  const rows = parseCsv(incidentsCsv);
  const empty = rows.length === 0 ? ["incidents: incidents.csv に行が無い"] : [];
  const problems = rows.flatMap((r) => checkRow(r, markerTimes)).map((p) => `incidents: ${p}`);
  return [...empty, ...problems, ...checkDrills(drillCsv)];
}
