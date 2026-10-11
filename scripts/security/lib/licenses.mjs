// ライセンス方針（security/license-policy.yaml）に対する評価。入力は license-inventory.mjs が lock から作る { "名前@版": { licenses } }。
// 方針: 許可リストに無いものはすべて違反（deny by default）。禁止パターンに当たるものは「禁止」、それ以外は「未許可・不明」と区別する。
import { globToRegExp } from "../../ci/lib/repo-fs.mjs";

// SPDX 式（OR / AND / WITH / 括弧）の簡易評価。OR はどれか 1 つ、AND はすべてが許可されていること。
export function tokenize(expr) {
  return String(expr)
    .replace(/([()])/g, " $1 ")
    .split(/\s+/)
    .filter(Boolean);
}

function parseOr(tokens, pos, ok) {
  let [val, i] = parseAnd(tokens, pos, ok);
  while (tokens[i] === "OR") {
    const [rhs, j] = parseAnd(tokens, i + 1, ok);
    val = val || rhs;
    i = j;
  }
  return [val, i];
}

function parseAnd(tokens, pos, ok) {
  let [val, i] = parseAtom(tokens, pos, ok);
  while (tokens[i] === "AND") {
    const [rhs, j] = parseAtom(tokens, i + 1, ok);
    val = val && rhs;
    i = j;
  }
  return [val, i];
}

function parseAtom(tokens, pos, ok) {
  if (tokens[pos] === "(") {
    const [val, i] = parseOr(tokens, pos + 1, ok);
    return [val, i + 1];
  }
  const id = tokens[pos];
  const next = tokens[pos + 1] === "WITH" ? pos + 3 : pos + 1;
  return [ok(id), next];
}

export const evaluateExpression = (expr, ok) => parseOr(tokenize(expr), 0, ok)[0];

export function licenseIds(expr) {
  return tokenize(expr).filter((t) => !["OR", "AND", "WITH", "(", ")"].includes(t));
}

export function normalizeLicenses(licenses) {
  const list = Array.isArray(licenses) ? licenses : [licenses];
  return list.map((l) => String(l ?? "UNKNOWN").trim()).join(" AND ");
}

const matchesAny = (patterns, id) => patterns.some((p) => globToRegExp(p).test(id));

function exceptionFor(policy, pkg, today) {
  return (policy.exceptions ?? []).find((e) => e.package === pkg && String(e.expires_at) >= today);
}

/** entries: { "name@version": { licenses } } → { violations, by_license, ... } */
export function evaluate(entries, policy, today) {
  const allow = policy.allow ?? [];
  const deny = policy.deny_patterns ?? [];
  const isAllowed = (id) => allow.includes(id);
  const violations = [];
  const byLicense = {};
  const used = [];
  for (const [pkg, info] of Object.entries(entries)) {
    const expr = normalizeLicenses(info.licenses);
    byLicense[expr] = (byLicense[expr] ?? 0) + 1;
    if (evaluateExpression(expr, isAllowed)) continue;
    const exc = exceptionFor(policy, pkg, today);
    if (exc) {
      used.push({ package: pkg, license: expr, reason: exc.reason, expires_at: exc.expires_at });
      continue;
    }
    const banned = licenseIds(expr).filter((id) => matchesAny(deny, id));
    violations.push({
      package: pkg,
      license: expr,
      kind: banned.length ? "禁止" : "未許可・不明",
      matched_deny: banned,
    });
  }
  return { packages: Object.keys(entries).length, by_license: byLicense, violations, exceptions_used: used };
}
