// リポジトリ設定（.github/settings/*）と GitHub 上の現在の設定の差分を求める（純粋関数）。
// 比較は「望む設定に書いてある項目だけ」を見る（GitHub が返す既定値や追加の項目は差分にしない）。
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameSet = (a, b) =>
  a.length === b.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const change = (path, from, to) => [{ path, from: from ?? null, to }];
const arraySame = (d, c) => Array.isArray(c) && (d.every(isObject) ? sameJson(d, c) : sameSet(d, c));

function objectDiff(desired, current, path) {
  return Object.entries(desired)
    .filter(([k]) => !k.startsWith("_"))
    .flatMap(([k, v]) => subsetDiff(v, current?.[k], path ? `${path}.${k}` : k));
}

/** desired の各項目を current と比べ、違うものを { path, from, to } で返す。_ で始まるキー（説明）は無視する。 */
export function subsetDiff(desired, current, path = "") {
  if (isObject(desired)) return objectDiff(desired, current, path);
  const same = Array.isArray(desired) ? arraySame(desired, current) : desired === current;
  return same ? [] : change(path, current, desired);
}

const byKey = (key) => (a, b) => String(a[key]).localeCompare(String(b[key]));

/** Ruleset を比較用の形にそろえる（id・source・日時など GitHub が付ける項目を落とし、並びを固定する）。 */
export function normalizeRuleset(r) {
  const rules = (r.rules ?? []).map((x) => ({
    type: x.type,
    ...(x.parameters ? { parameters: normalizeParams(x.parameters) } : {}),
  }));
  return {
    name: r.name,
    target: r.target,
    enforcement: r.enforcement,
    conditions: r.conditions,
    bypass_actors: (r.bypass_actors ?? []).map(({ actor_id, actor_type, bypass_mode }) => ({
      actor_id,
      actor_type,
      bypass_mode,
    })),
    rules: rules.sort(byKey("type")),
  };
}

function normalizeParams(p) {
  const out = { ...p };
  if (out.required_status_checks) {
    out.required_status_checks = out.required_status_checks
      .map(({ context, integration_id }) => ({ context, integration_id }))
      .sort(byKey("context"));
  }
  return out;
}

/** 望む Ruleset と現在の Ruleset の差分。ルールの有無は種類ごと、中身は望む項目だけ比べる。 */
export function rulesetDiff(desired, current) {
  const d = normalizeRuleset(desired);
  const c = normalizeRuleset(current);
  const head = subsetDiff(
    {
      name: d.name,
      target: d.target,
      enforcement: d.enforcement,
      conditions: d.conditions,
      bypass_actors: d.bypass_actors,
    },
    c,
  );
  const have = new Map(c.rules.map((r) => [r.type, r]));
  const missing = d.rules
    .filter((r) => !have.has(r.type))
    .map((r) => ({ path: `rules.${r.type}`, from: null, to: "追加" }));
  const extra = c.rules
    .filter((r) => !d.rules.some((x) => x.type === r.type))
    .map((r) => ({ path: `rules.${r.type}`, from: "有り", to: "削除" }));
  const changed = d.rules
    .filter((r) => have.has(r.type) && r.parameters)
    .flatMap((r) => subsetDiff(r.parameters, have.get(r.type).parameters, `rules.${r.type}`));
  return [...head, ...missing, ...extra, ...changed];
}

export function labelDiff(desired, current) {
  const have = new Map(current.map((l) => [l.name, l]));
  return desired.map((l) => {
    const cur = have.get(l.name);
    if (!cur) return { name: l.name, action: "create" };
    const same =
      cur.color.toLowerCase() === l.color.toLowerCase() && (cur.description ?? "") === (l.description ?? "");
    return { name: l.name, action: same ? "same" : "update" };
  });
}

export const formatDiff = (diffs) =>
  diffs.map((d) => `    ~ ${d.path}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`).join("\n");
