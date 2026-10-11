// 集約ジョブ（security-result）の判定。needs の結果がすべて success でなければ失敗。
// skipped は成功扱いにしない。ただし「そのイベントでは動かないと宣言されているジョブ」だけは、動かなかったことを許す。
// （逆に、動くべきイベントで skipped になっていれば失敗。）
export const EVENT_ONLY = {
  "dependency-review": ["pull_request"], // PR の差分でしか意味が無い
  scorecard: ["schedule"], // リポジトリ全体の定期評価
};

export function judge(needs, event, eventOnly = EVENT_ONLY) {
  const rows = Object.entries(needs).map(([job, v]) => {
    const onlyOn = eventOnly[job];
    const mayBeSkipped = onlyOn && !onlyOn.includes(event);
    const ok = v.result === "success" || (mayBeSkipped && v.result === "skipped");
    return { job, result: v.result, ok, note: mayBeSkipped ? `${onlyOn.join("/")} のときだけ動く` : null };
  });
  return { rows, pass: rows.every((r) => r.ok) };
}
