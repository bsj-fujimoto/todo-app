// GitHub の Code Scanning のアラートと、台帳（security/accepted-risks.yaml）のずれを検出する（純粋関数）。
// 規則:
//   - 台帳で受容した検出（tool・rule_id・場所が一致）に対応するアラートは、GitHub 側で dismissed にし、コメントに AR-ID を書く
//   - 台帳に無いアラートが open のまま残っていたら、台帳へ記録するか、直す（放置させない）
//   - 台帳に無いのに dismissed になっているアラートは、理由の裏付けが無い（台帳へ記録する）
//   - 期限切れの受容に対応するアラートが dismissed のままなら、再検査する（台帳の期限切れは check-policy も検出する）
import { globToRegExp } from "../../ci/lib/repo-fs.mjs";

const toolOf = (a) => String(a.tool?.name ?? "").toLowerCase();
const pathOf = (a) => String(a.most_recent_instance?.location?.path ?? "");
const globOk = (pattern, value) => !pattern || globToRegExp(String(pattern)).test(String(value ?? ""));

/** 台帳の match（tool / rule_id / location）がアラートに当たるか。tool の指定が必須。 */
export function ledgerMatches(entry, alert) {
  const m = entry.match ?? {};
  return (
    String(m.tool ?? "").toLowerCase() === toolOf(alert) &&
    globOk(m.rule_id, alert.rule?.id) &&
    globOk(m.location, pathOf(alert))
  );
}

const label = (a) =>
  `#${a.number} ${a.rule?.id} ${pathOf(a)}:${a.most_recent_instance?.location?.start_line ?? "?"}`;

function withoutEntry(alert) {
  if (alert.state === "dismissed")
    return [
      `${label(alert)}: 台帳（accepted-risks.yaml）に無いのに GitHub 側で dismissed になっている（台帳へ記録する）`,
    ];
  if (alert.state === "open")
    return [
      `${label(alert)}: 台帳に無い open のアラート（直すか、accepted-risks.yaml に期限付きで記録して dismissed にする）`,
    ];
  return [];
}

function withEntry(alert, entry, today) {
  if (alert.state === "open") {
    return [
      `${label(alert)}: 台帳の ${entry.id} で受容済みなのに GitHub 側で open（dismissed にして、コメントに ${entry.id}・期限・Issue を書く）`,
    ];
  }
  if (alert.state !== "dismissed") return [];
  return [
    !String(alert.dismissed_comment ?? "").includes(entry.id) &&
      `${label(alert)}: dismissed のコメントに ${entry.id} が無い`,
    String(entry.expires_at) < today &&
      `${label(alert)}: ${entry.id} は期限切れ（${entry.expires_at}）。再検査する`,
  ].filter(Boolean);
}

/** このコミットの CodeQL の結果（{ ruleId, uri }）に、そのアラートがまだ出ているか。current が無ければ（結果を渡さないとき）出ているものとして扱う。 */
const stillPresent = (alert, current) =>
  !current || current.some((r) => r.ruleId === alert.rule?.id && r.uri === pathOf(alert));

const fixedHere = (alert) =>
  `${label(alert)}: このコミットでは検出されない（修正済み）。GitHub 側のアラートはマージ後の main の解析で fixed になるので、台帳からは外してよい`;

/** { problems, warnings }。台帳に無いアラートが、このコミットでは検出されない（修正済み）なら、問題ではなく警告にする。 */
const judge = (alert, accepted, today, current) => {
  const entry = accepted.find((e) => ledgerMatches(e, alert));
  if (entry) return { problems: withEntry(alert, entry, today), warnings: [] };
  if (!stillPresent(alert, current)) return { problems: [], warnings: [fixedHere(alert)] };
  return { problems: withoutEntry(alert), warnings: [] };
};

const count = (alerts, state) => alerts.filter((a) => a.state === state).length;

export function compareAlerts(alerts, accepted, today, current = null) {
  const codeql = alerts.filter((a) => toolOf(a) === "codeql");
  const stale = accepted
    .filter(
      (e) => String(e.match?.tool).toLowerCase() === "codeql" && !codeql.some((a) => ledgerMatches(e, a)),
    )
    .map((e) => `${e.id}: 対応するアラートが無い（GitHub 側で fixed になったなら台帳から外す）`);
  const judged = codeql.map((a) => judge(a, accepted, today, current));
  return {
    problems: judged.flatMap((j) => j.problems),
    warnings: [...judged.flatMap((j) => j.warnings), ...stale],
    stats: { alerts: codeql.length, open: count(codeql, "open"), dismissed: count(codeql, "dismissed") },
  };
}
