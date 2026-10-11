// 実行結果の要約（$GITHUB_STEP_SUMMARY 用の Markdown）。純関数。
const ICON = { ok: "OK", fail: "FAIL", skipped: "SKIP" };

const cell = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");

function header(run) {
  const target =
    run.mode === "release"
      ? "リリース済みイメージ（digest 固定）"
      : "フォールバック: docker compose up --build（main の HEAD）";
  return [
    "## 外形監視の実行結果",
    "",
    `- 対象: **${target}**`,
    `- 版: ${run.version || "不明"}（期待: ${run.expected_version || "未指定"} / ${run.expected_commit || "未指定"}）`,
    `- 実行: ${run.run_id}（${run.phase}）、UTC ${run.started_at}、環境: ${run.region}`,
    "",
    "| monitor | 名前 | 種別 | 結果 | 試行 | 時間 (ms) | 備考 |",
    "|---|---|---|---|---|---|---|",
  ];
}

function noteOf(r) {
  const detail = r.failure_detail || "";
  return r.alert_suppressed ? `通知を抑制: ${r.suppression_reason}。${detail}` : detail;
}

function row(r) {
  const result = ICON[r.result] || r.result;
  return `| ${r.monitor_id} | ${cell(r.name)} | ${r.type} | ${result} | ${r.attempts} | ${r.duration_ms} | ${cell(noteOf(r))} |`;
}

function skippedRow(s) {
  return `| ${s.monitor_id} | ${cell(s.name)} | ${s.type} | ${ICON.skipped} | - | - | 無効: ${cell(s.disabled_reason)} |`;
}

export function renderSummary(run, records, skipped) {
  const fails = records.filter((r) => r.result === "fail");
  const suppressed = fails.filter((r) => r.alert_suppressed).length;
  const lines = [...header(run), ...records.map(row), ...skipped.map(skippedRow), ""];
  const ok = records.length - fails.length;
  lines.push(
    `成功 ${ok} / ${records.length}、失敗 ${fails.length}（うち通知抑制 ${suppressed}）、無効 ${skipped.length}`,
  );
  return `${lines.join("\n")}\n`;
}

// 監視対象の決定（resolve-target の target.json）の要約
export function renderTargetSummary(t) {
  const mode =
    t.mode === "release"
      ? "リリース済みイメージ（digest 固定）"
      : "フォールバック（main の HEAD を docker compose up --build）";
  const lines = ["## 監視対象", "", `- モード: **${mode}**`, `- 理由: ${t.reason}`];
  for (const [service, ref] of Object.entries(t.images)) lines.push(`- ${service}: \`${ref}\``);
  return `${lines.join("\n")}\n`;
}
