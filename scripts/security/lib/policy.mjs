// セキュリティの方針ファイル（台帳）の形式・期限の検査。検出が無くても、台帳が腐っていれば落とす。
import { isFile, readText } from "../../ci/lib/repo-fs.mjs";
import { parseYaml } from "../../ci/lib/yaml-lite.mjs";
import { loadEntries, validateAccepted, validateTriage } from "./ledger.mjs";
import { parseRules, validateRules } from "./zap.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const REVIEW_DAYS = 180;

function exceptionProblem(e, today) {
  if (!e.package || !e.reason || !DATE_RE.test(String(e.expires_at))) {
    return `license-policy.yaml: 例外 ${e.package ?? "?"} に reason / expires_at が必要`;
  }
  return String(e.expires_at) < today
    ? `license-policy.yaml: 例外 ${e.package} の期限切れ（${e.expires_at}）`
    : null;
}

function licenseProblems(root, today) {
  if (!isFile(root, "security/license-policy.yaml")) return ["security/license-policy.yaml が無い"];
  const p = parseYaml(readText(root, "security/license-policy.yaml")) ?? {};
  const empty = (p.allow ?? []).length ? [] : ["license-policy.yaml: allow が空"];
  return [...empty, ...(p.exceptions ?? []).map((e) => exceptionProblem(e, today)).filter(Boolean)];
}

const listOf = (text, key) =>
  (new RegExp(`${key}:\\s*(.+)`).exec(text)?.[1] ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// Dependency review のライセンス設定（security.yml）は、ライセンス方針の写し。ずれると PR の差分検査と全体検査で判定が食い違う。
function mirrorProblems(root) {
  const wf = ".github/workflows/security.yml";
  if (!isFile(root, wf) || !isFile(root, "security/license-policy.yaml")) return [];
  const text = readText(root, wf);
  const policy = parseYaml(readText(root, "security/license-policy.yaml")) ?? {};
  const out = [];
  if (!sameSet(listOf(text, "allow-licenses"), policy.allow ?? [])) {
    out.push("security.yml の allow-licenses が license-policy.yaml の allow と一致しない");
  }
  const exc = (policy.exceptions ?? []).map(
    (e) =>
      `pkg:npm/${String(e.package)
        .replace(/@[^@/]+$/, "")
        .replace(/^@/, "%40")}`,
  );
  if (!sameSet(listOf(text, "allow-dependencies-licenses"), exc)) {
    out.push("security.yml の allow-dependencies-licenses が license-policy.yaml の exceptions と一致しない");
  }
  return out;
}

function selectionProblems(root, today) {
  const path = "security/dependency-selection.yaml";
  if (!isFile(root, path)) return [`${path} が無い`];
  const deps = (parseYaml(readText(root, path)) ?? {}).dependencies ?? [];
  return deps.flatMap((d) => {
    const miss = [
      "name",
      "workspace",
      "kind",
      "reason",
      "alternatives",
      "maintenance",
      "last_checked",
    ].filter((k) => !d[k]);
    if (miss.length) return [`dependency-selection.yaml: ${d.name ?? "?"} に ${miss.join(",")} が無い`];
    const age = Math.round((Date.parse(today) - Date.parse(d.last_checked)) / DAY);
    return age > REVIEW_DAYS
      ? [`dependency-selection.yaml: ${d.name} の最終確認が ${age} 日前（${REVIEW_DAYS} 日ごとに見直す）`]
      : [];
  });
}

export function checkPolicy(root, today) {
  const zap = isFile(root, "security/zap-rules.tsv")
    ? validateRules(parseRules(readText(root, "security/zap-rules.tsv")), today)
    : ["security/zap-rules.tsv が無い"];
  return [
    ...zap,
    ...validateTriage(loadEntries(root, "security/triage.yaml")),
    ...validateAccepted(loadEntries(root, "security/accepted-risks.yaml"), today),
    ...licenseProblems(root, today),
    ...mirrorProblems(root),
    ...selectionProblems(root, today),
  ];
}
