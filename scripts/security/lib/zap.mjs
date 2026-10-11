// OWASP ZAP のレポート（-J の JSON）→ SARIF。security/zap-rules.tsv のしきい値と除外を適用する。
//   IGNORE : 検出から外す（理由・owner・期限つきで zap-rules.tsv に書く）
//   WARN   : ZAP の重要度（riskcode）のまま扱う
//   FAIL   : 少なくとも high として扱う（未解決ならゲートで失敗）
//   無記載 : WARN と同じ
const SCORE = { 3: 8.0, 2: 5.5, 1: 3.0, 0: 0 };
const LEVEL = { 3: "error", 2: "warning", 1: "note", 0: "none" };

export function parseRules(tsv) {
  const rules = new Map();
  for (const raw of tsv.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [id, action, ...rest] = line.split("\t");
    rules.set(id.trim(), { action: (action ?? "").trim().toUpperCase(), comment: rest.join("\t").trim() });
  }
  return rules;
}

const kv = (comment, key) => new RegExp(`${key}=([^;\\s]+)`).exec(comment)?.[1] ?? null;

/** IGNORE の行に理由・期限が書かれ、期限内か。違反の説明を返す。 */
export function validateRules(rules, today) {
  const problems = [];
  for (const [id, r] of rules) {
    if (!["IGNORE", "WARN", "FAIL", "INFO"].includes(r.action))
      problems.push(`zap-rules.tsv ${id}: 動作 ${r.action} が不正`);
    if (r.action !== "IGNORE") continue;
    const reason = r.comment.split(";")[0].trim();
    const expires = kv(r.comment, "expires");
    if (!reason) problems.push(`zap-rules.tsv ${id}: IGNORE に理由が無い`);
    if (!kv(r.comment, "owner")) problems.push(`zap-rules.tsv ${id}: IGNORE に owner= が無い`);
    if (!expires) problems.push(`zap-rules.tsv ${id}: IGNORE に expires=YYYY-MM-DD が無い`);
    else if (expires < today) problems.push(`zap-rules.tsv ${id}: IGNORE の期限切れ（${expires}）`);
  }
  return problems;
}

// ZAP は同じプラグインでも、指摘の種類ごとに alertRef（10049-3 など）を振る。検出を区別できるよう alertRef を ID にする。
const refOf = (alert) => String(alert.alertRef ?? alert.pluginid);
const riskOf = (alert) => Number(alert.riskcode ?? 0);
const effectiveScore = (alert, action) =>
  action === "FAIL" ? Math.max(SCORE[riskOf(alert)], 7.5) : SCORE[riskOf(alert)];

function toResult(site, alert, rules) {
  const action = rules.get(String(alert.pluginid))?.action;
  const uris = (alert.instances ?? []).map((i) => `${i.method ?? "GET"} ${i.uri}`);
  const level = action === "FAIL" ? "error" : LEVEL[riskOf(alert)];
  return {
    ruleId: refOf(alert),
    level,
    message: {
      text: `${alert.name ?? alert.alert}（${alert.riskdesc}）。影響する URL ${uris.length} 件: ${uris.slice(0, 5).join(", ")}`,
    },
    locations: [{ physicalLocation: { artifactLocation: { uri: site["@name"] } } }],
    properties: {
      "security-severity": String(effectiveScore(alert, action)),
      instances: uris.length,
      cweid: alert.cweid,
      confidence: alert.confidence,
    },
  };
}

const ruleOf = (alert) => ({
  id: refOf(alert),
  name: alert.name ?? alert.alert,
  shortDescription: { text: alert.name ?? alert.alert },
  helpUri: `https://www.zaproxy.org/docs/alerts/${alert.pluginid}/`,
  properties: { tags: ["dast", `cwe-${alert.cweid}`], "security-severity": String(SCORE[riskOf(alert)]) },
});

export function zapToSarif(report, rules, extra = {}) {
  const alerts = (report.site ?? []).flatMap((site) => (site.alerts ?? []).map((a) => ({ site, a })));
  const ignored = alerts.filter(({ a }) => rules.get(String(a.pluginid))?.action === "IGNORE");
  const kept = alerts.filter((x) => !ignored.includes(x));
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "OWASP ZAP",
            semanticVersion: report["@version"] ?? null,
            informationUri: "https://www.zaproxy.org/",
            rules: [...new Map(kept.map(({ a }) => [refOf(a), ruleOf(a)])).values()],
          },
        },
        results: kept.map(({ site, a }) => toResult(site, a, rules)),
        properties: extra,
      },
    ],
  };
  return {
    sarif,
    ignored: ignored.map(({ a }) => ({
      pluginid: a.pluginid,
      name: a.name,
      rule: rules.get(String(a.pluginid)),
    })),
  };
}
