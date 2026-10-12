// 検査ツールの出力（SARIF / npm audit JSON）→ 共通の Finding。機械が決められること（重要度の写像・指紋・別名）だけをここで行う。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const ADVISORY = /(CVE-\d{4}-\d{4,}|GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})/gi;

// SARIF の level → 重要度。security-severity（CVSS）があればそちらを優先する。
// hadolint（Dockerfile の書き方の指摘）は、error でも「重大な脆弱性」ではないので 1 段下げる。
const LEVEL_DEFAULT = { error: "high", warning: "medium", note: "low", none: "info" };
const LEVEL_BY_TOOL = {
  hadolint: { error: "medium", warning: "low", note: "info", style: "info", info: "info" },
};
const TAG_CATEGORY = { vulnerability: "sca", misconfiguration: "iac", secret: "secret" };

// ツール名は SARIF の driver.name（"CodeQL"・"OWASP ZAP" など）を小文字・ハイフン区切りにそろえて台帳や指紋に使う。
export const slug = (name) => String(name).trim().toLowerCase().replace(/\s+/g, "-");

export function severityFromScore(score) {
  const s = Number(score);
  if (score === null || score === undefined || Number.isNaN(s)) return null;
  if (s >= 9) return "critical";
  if (s >= 7) return "high";
  if (s >= 4) return "medium";
  return s > 0 ? "low" : "info";
}

export const normalizeSeverity = (v) => {
  const s = String(v ?? "").toLowerCase();
  if (s === "moderate") return "medium";
  return SEVERITIES.includes(s) ? s : null;
};

export const advisoryIds = (...texts) => {
  const found = texts.join(" ").match(ADVISORY) ?? [];
  return [...new Set(found.map((x) => x.toUpperCase()))];
};

export function fingerprint({ tool, rule_id, location, component }) {
  const path = String(location ?? "").replace(/:\d+(:\d+)?$/, "");
  return createHash("sha256")
    .update([tool, rule_id, path, component ?? ""].join("|"))
    .digest("hex")
    .slice(0, 16);
}

// 深い階層の安全な取得と「最初に値があるもの」。?. と ?? を並べると複雑度の上限（8）をすぐ超えるので、ここに寄せる。
const at = (obj, path) => path.split(".").reduce((x, k) => x?.[k], obj);
const first = (...values) => values.find((v) => v !== undefined && v !== null) ?? null;

const tagsOf = (rule, result) =>
  [...(at(rule, "properties.tags") ?? []), ...(at(result, "properties.tags") ?? [])].map((t) =>
    String(t).toLowerCase(),
  );

// trivy の SARIF は 1 ファイルに脆弱性・設定誤り・秘密情報が混ざる。rule のタグで分類し、無ければ検査の種別を使う。
function categoryOf(rule, result, fallback) {
  const hit = tagsOf(rule, result).find((t) => TAG_CATEGORY[t]);
  if (!hit) return fallback;
  return hit === "vulnerability" && fallback === "container" ? "container" : TAG_CATEGORY[hit];
}

const scoreOf = (rule, result) =>
  first(at(result, "properties.security-severity"), at(rule, "properties.security-severity"));

function sarifSeverity(tool, rule, result) {
  const fromScore = severityFromScore(scoreOf(rule, result));
  if (scoreOf(rule, result) !== null && fromScore) return fromScore;
  const level = first(result.level, at(rule, "defaultConfiguration.level"), "warning");
  return (LEVEL_BY_TOOL[tool] ?? LEVEL_DEFAULT)[level] ?? "medium";
}

function locationOf(result) {
  const loc = at(result, "locations.0.physicalLocation");
  const uri = first(at(loc, "artifactLocation.uri"), "unknown");
  const line = at(loc, "region.startLine");
  return line ? `${uri}:${line}` : uri;
}

// trivy の SARIF は部品・版を message の行（"Package: x" / "Installed Version: 1.0" / "Fixed Version: 1.1"）にだけ書く。
const field = (message, name) => new RegExp(`^${name}:\\s*(.+)$`, "m").exec(message)?.[1]?.trim() ?? null;

const componentOf = (result, rule, message) =>
  first(
    at(result, "properties.pkgName"),
    at(result, "properties.package"),
    at(result, "properties.component"),
    at(rule, "properties.pkgName"),
    field(message, "Package"),
  );

// CodeQL のルールは driver ではなく拡張（query pack）の rules にある。
const rulesOf = (run) => [
  ...(at(run, "tool.driver.rules") ?? []),
  ...(at(run, "tool.extensions") ?? []).flatMap((x) => x.rules ?? []),
];

// イメージの SARIF は場所が一時ファイル（.tar）になるので、検査したイメージ名にそろえる。
const placeOf = (location, image) => (image && /\.tar(:\d+)?$/.test(location) ? image : location);

const titleOf = (rule, result, id) =>
  first(at(rule, "shortDescription.text"), at(rule, "name"), at(result, "message.text")?.slice(0, 100), id);

function sarifFinding(run, result, scanMeta) {
  const tool = slug(first(at(run, "tool.driver.name"), scanMeta.tool, "unknown"));
  const rule_id = first(result.ruleId, at(result, "rule.id"), "unknown");
  const rule = rulesOf(run).find((r) => r.id === rule_id);
  const title = titleOf(rule, result, rule_id);
  const message = first(at(result, "message.text"), "");
  const location = placeOf(locationOf(result), scanMeta.image);
  const component = componentOf(result, rule, message);
  return {
    fingerprint: fingerprint({ tool, rule_id, location, component }),
    tool,
    scan: scanMeta.scan,
    category: categoryOf(rule, result, scanMeta.check_kind),
    rule_id,
    title,
    severity: sarifSeverity(tool, rule, result),
    location,
    component,
    message: message.slice(0, 500),
    // 別名は ID と参照 URL からだけ拾う（本文に書かれた「関連する別の CVE」を同一視して、別の脆弱性を dup にしない）
    advisories: advisoryIds(rule_id, first(at(rule, "helpUri"), "")),
    help_uri: first(at(rule, "helpUri")),
    fixed_version: first(at(result, "properties.fixedVersion"), field(message, "Fixed Version")),
    installed_version: first(field(message, "Installed Version")),
  };
}

const isFail = (r) => (r.kind ?? "fail") === "fail";

/** SARIF 1 ファイル → Finding[]。kind が "fail" 以外（pass / informational）は検出として数えない。 */
export function findingsFromSarif(doc, scanMeta) {
  return (doc.runs ?? []).flatMap((run) =>
    (run.results ?? []).filter(isFail).map((r) => sarifFinding(run, r, scanMeta)),
  );
}

const npmVia = (v) => (typeof v === "string" ? { name: v } : v);
const npmFix = (vuln) =>
  typeof vuln.fixAvailable === "object" ? (vuln.fixAvailable?.version ?? null) : null;

function npmFinding(name, vuln, via, scanMeta) {
  const ids = advisoryIds(first(via.url, ""));
  const rule_id = first(ids[0], `npm-advisory-${via.source}`);
  const location = "package-lock.json";
  return {
    fingerprint: fingerprint({ tool: "npm-audit", rule_id, location, component: name }),
    tool: "npm-audit",
    scan: scanMeta.scan,
    category: "sca",
    rule_id,
    title: first(via.title, rule_id),
    severity: first(normalizeSeverity(via.severity), "medium"),
    location,
    component: name,
    message: `${name} ${first(via.range, "")}: ${first(via.title, "")}`.trim(),
    advisories: ids,
    help_uri: first(via.url),
    fixed_version: npmFix(vuln),
    cvss: first(at(via, "cvss.score")),
  };
}

/** npm audit --json（auditReportVersion 2）→ Finding[]。1 つの勧告（source）につき 1 件。 */
export function findingsFromNpmAudit(doc, scanMeta) {
  return Object.entries(doc.vulnerabilities ?? {}).flatMap(([name, vuln]) =>
    (vuln.via ?? [])
      .map(npmVia)
      .filter((v) => v.source)
      .map((via) => npmFinding(name, vuln, via, scanMeta)),
  );
}

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
