// メンテナンス窓・抑制ルールの評価。純関数。抑制に当たったら { rule_id, reason }、当たらなければ null。
const inMonitorList = (ids, monitorId) => !ids || ids.length === 0 || ids.includes(monitorId);

function matchWindow(w, monitorId, nowMs) {
  if (!inMonitorList(w.monitor_ids, monitorId)) return null;
  if (nowMs < Date.parse(w.from) || nowMs > Date.parse(w.to)) return null;
  return {
    rule_id: w.id || "maintenance-window",
    reason: `計画停止の窓（${w.from} 〜 ${w.to}）${w.reason ? `: ${w.reason}` : ""}`,
  };
}

// 最新のマーカーが示す「変更があった時刻」（リリース公開時刻、または health の版が変わったと観測した時刻）の最大値
export function latestChangeMs(markers) {
  const times = markers
    .flatMap((m) => [m.release_published_at, m.version_changed_at])
    .filter(Boolean)
    .map((t) => Date.parse(t));
  return times.length ? Math.max(...times) : null;
}

function matchAfterRelease(rule, monitorId, nowMs, markers) {
  if (!inMonitorList(rule.monitor_ids, monitorId)) return null;
  const changed = latestChangeMs(markers);
  if (changed === null) return null;
  const elapsedMin = (nowMs - changed) / 60000;
  if (elapsedMin < 0 || elapsedMin > rule.minutes) return null;
  return {
    rule_id: rule.id,
    reason: `リリース直後 ${rule.minutes} 分の抑制（変更から ${Math.round(elapsedMin * 10) / 10} 分）`,
  };
}

export function evaluateSuppression({ monitorId, nowMs, maintenance, markers }) {
  for (const w of maintenance.maintenance_windows || []) {
    const hit = matchWindow(w, monitorId, nowMs);
    if (hit) return hit;
  }
  for (const rule of maintenance.suppression_rules || []) {
    if (rule.kind !== "after_release") continue;
    const hit = matchAfterRelease(rule, monitorId, nowMs, markers);
    if (hit) return hit;
  }
  return null;
}
