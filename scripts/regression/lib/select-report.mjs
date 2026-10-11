// 選択結果の表示（$GITHUB_STEP_SUMMARY 用 Markdown と $GITHUB_OUTPUT 用の行）。

export function renderSelection(r, meta) {
  const head = r.mode === "full" ? "全件実行" : `選択実行（${r.selected_case_ids.length} ケース）`;
  const lines = [
    "### 回帰テストの選択（変更影響）",
    "",
    `- 対象 SHA: \`${meta.sha}\` / 比較元: \`${meta.base}\``,
    `- モード: **${head}**`,
    "- 選択理由（selection_reason）:",
    ...r.selection_reason.map((x) => `  - ${x}`),
  ];
  if (r.mode === "selected") {
    lines.push(`- 選択した TC: ${r.selected_case_ids.join(", ")}`);
    const ex = r.excluded_risks.map(
      (x) => `${x.risk_id}（除外 ${x.excluded_cases.length}/${x.total_cases}）`,
    );
    lines.push(`- 今回外したことで検証されないリスク: ${ex.join(", ") || "なし"}`);
    for (const n of r.excluded_risk_notes) lines.push(`  - ${n.entry}: ${n.note}`);
    lines.push("- 外したケースは main への push・日次・週次・リリース前の全件回帰で検証する。");
  }
  return `${lines.join("\n")}\n`;
}

/** GITHUB_OUTPUT は 1 行 1 値。改行を含まないよう JSON 化・整形して出す。 */
export function outputLines(r) {
  return [
    `mode=${r.mode}`,
    `grep_e2e=${r.grep_e2e}`,
    `name_pattern=${r.name_pattern_unit_api}`,
    `case_count=${r.selected_case_ids.length}`,
    `unmapped=${r.unmapped_paths.length}`,
  ];
}
