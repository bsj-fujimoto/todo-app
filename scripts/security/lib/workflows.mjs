// GitHub Actions のワークフローを機械検査する（ルールは W1〜W10）。逸脱があれば呼び出し側が失敗にする。
// 1 ルール 1 関数。どれも { rule, file, job?, message } の配列を返す。

const SHA = /^[0-9a-f]{40}$/;
const UNTRUSTED =
  /\$\{\{[^}]*(github\.head_ref|github\.event\.[\w.[\]*-]*\.(title|body|label|message|email|name|default_branch|head\.ref|ref))[^}]*\}\}/;
const FORK_GUARD = "github.event.pull_request.head.repo.full_name == github.repository";

const v = (rule, file, message, job) => ({ rule, file, job: job ?? null, message });
export const jobsOf = (doc) => Object.entries(doc.jobs ?? {});

export function eventsOf(doc) {
  const on = doc.on ?? doc.true;
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on ?? {});
}

const writes = (perms) =>
  perms && typeof perms === "object"
    ? Object.entries(perms)
        .filter(([, val]) => val === "write")
        .map(([k]) => k)
    : [];

// W1: permissions を明示し、ワークフロー直下は読み取りだけ（write-all / read-all も不可）
export function permissionsRule(file, doc) {
  const p = doc.permissions;
  if (p === undefined) return [v("W1", file, "トップレベルに permissions が無い（明示した最小権限にする）")];
  if (typeof p === "string") return [v("W1", file, `permissions: ${p} は広すぎる（個別の権限を書く）`)];
  return writes(p).map((k) =>
    v("W1", file, `トップレベルで ${k}: write を付けている（必要なジョブだけに付ける）`),
  );
}

function stepUses(step) {
  return typeof step.uses === "string" ? [step.uses] : [];
}

export function usesOf(doc) {
  const jobUses = jobsOf(doc).flatMap(([id, j]) =>
    [...(typeof j.uses === "string" ? [j.uses] : []), ...(j.steps ?? []).flatMap(stepUses)].map((u) => ({
      id,
      uses: u,
    })),
  );
  return jobUses;
}

// W2: action はコミット SHA で固定（ローカル ./ と docker:// 以外）
export function pinRule(file, uses) {
  return uses
    .filter(({ uses: u }) => !u.startsWith("./") && !u.startsWith("docker://"))
    .filter(({ uses: u }) => !SHA.test(u.split("@")[1] ?? ""))
    .map(({ id, uses: u }) => v("W2", file, `SHA で固定されていない: ${u}`, id));
}

// W3: pull_request_target は使わない
export const prtRule = (file, doc) =>
  eventsOf(doc).includes("pull_request_target") ? [v("W3", file, "pull_request_target を使っている")] : [];

// W4: タイムアウト（reusable workflow を呼ぶジョブは timeout-minutes を持てないので除く）
export const timeoutRule = (file, doc) =>
  jobsOf(doc)
    .filter(([, j]) => !j.uses && typeof j["timeout-minutes"] !== "number")
    .map(([id]) => v("W4", file, "timeout-minutes が無い", id));

// W5: concurrency
export function concurrencyRule(file, doc) {
  if (doc.concurrency) return [];
  const bare = jobsOf(doc).filter(([, j]) => !j.concurrency && !j.uses);
  return bare.length ? [v("W5", file, "concurrency が無い（ワークフロー直下か、全ジョブに）")] : [];
}

function findKey(node, key, path = []) {
  if (Array.isArray(node)) return node.flatMap((x, i) => findKey(x, key, [...path, i]));
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([k, val]) =>
    k === key ? [{ path: [...path, k], value: val }] : findKey(val, key, [...path, k]),
  );
}

// W6: continue-on-error は使わない（false 以外はすべて違反）
export const continueOnErrorRule = (file, doc) =>
  findKey(doc, "continue-on-error")
    .filter((x) => x.value !== false)
    .map((x) => v("W6", file, `continue-on-error が ${x.path.join(".")} にある`));

const usesSecrets = (job) => /secrets\.(?!GITHUB_TOKEN\b)\w+|secrets:\s*inherit/.test(JSON.stringify(job));

// W7: フォークの PR に secret を渡さない
export function forkSecretRule(file, doc) {
  const forkable = eventsOf(doc).some((e) => ["pull_request", "pull_request_target"].includes(e));
  if (!forkable) return [];
  return jobsOf(doc)
    .filter(([, j]) => usesSecrets(j) && !String(j.if ?? "").includes(FORK_GUARD))
    .map(([id]) =>
      v(
        "W7",
        file,
        "フォーク PR で動くのに secret を使っている（head.repo の一致で守るか、secret を外す）",
        id,
      ),
    );
}

// W8: OIDC（id-token: write）はトップレベル禁止。許可したジョブだけ
export function oidcRule(file, doc, policy) {
  const top = writes(doc.permissions).includes("id-token")
    ? [v("W8", file, "トップレベルで id-token: write")]
    : [];
  const allowed = new Set(policy.id_token_write_jobs ?? []);
  const jobs = jobsOf(doc)
    .filter(([id, j]) => writes(j.permissions).includes("id-token") && !allowed.has(`${file}#${id}`))
    .map(([id]) =>
      v(
        "W8",
        file,
        "id-token: write は許可リスト（security/workflow-policy.yaml）に無いジョブでは使えない",
        id,
      ),
    );
  return [...top, ...jobs];
}

// W9: 攻撃者が書ける値を run に直接埋め込まない（環境変数経由にする）
export const injectionRule = (file, doc) =>
  jobsOf(doc).flatMap(([id, j]) =>
    (j.steps ?? [])
      .filter((s) => typeof s.run === "string" && UNTRUSTED.test(s.run))
      .map((s) =>
        v("W9", file, `run に信頼できない値を直接埋め込んでいる: ${s.name ?? s.run.slice(0, 40)}`, id),
      ),
  );

// W10: ジョブの write 権限は許可リストにあるものだけ
export function writeAllowlistRule(file, doc, policy) {
  const table = policy.write_permissions ?? {};
  return jobsOf(doc).flatMap(([id, j]) => {
    if (j.permissions === "write-all") return [v("W10", file, "permissions: write-all", id)];
    const allowed = new Set(table[`${file}#${id}`] ?? []);
    return writes(j.permissions)
      .filter((k) => k !== "id-token" && !allowed.has(k))
      .map((k) => v("W10", file, `${k}: write は許可リスト（security/workflow-policy.yaml）に無い`, id));
  });
}

export function checkWorkflow(file, doc, policy) {
  return [
    ...permissionsRule(file, doc),
    ...pinRule(file, usesOf(doc)),
    ...prtRule(file, doc),
    ...timeoutRule(file, doc),
    ...concurrencyRule(file, doc),
    ...continueOnErrorRule(file, doc),
    ...forkSecretRule(file, doc),
    ...oidcRule(file, doc, policy),
    ...injectionRule(file, doc),
    ...writeAllowlistRule(file, doc, policy),
  ];
}

/** composite action（.github/actions/<名前>/action.yml）の uses も SHA 固定を検査する。 */
export function checkComposite(file, doc) {
  const uses = (doc.runs?.steps ?? []).flatMap(stepUses).map((u) => ({ id: "composite", uses: u }));
  return pinRule(file, uses);
}
