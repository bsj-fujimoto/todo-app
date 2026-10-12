// consumer contract の検証結果（backend/test/contract/consumer-contract.test.js が出す JSON）を、
// ci-summary.json の consumer_contracts に載せる形（ConsumerContract）に整える。純粋関数（時刻・SHA は呼び出し側が渡す）。
//   { consumer, provider, tool, tool_version, verified_at, result, commit_sha, pact_file, pact_sha256, interactions: {total, passed, failed} }
// result: passed | failed | not_run（結果ファイルが無い = 検証が走っていない。成功にしない）

const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, source?.[key] ?? null]));

export function toConsumerContract(record, { nowIso, commitSha }) {
  const interactions = record.interactions ?? [];
  const passed = interactions.filter((i) => i.result === "passed").length;
  const ok = record.result === "passed" && passed === interactions.length;
  const tool = pick(record.tool, ["name", "version"]);
  return {
    ...pick(record, ["consumer", "provider"]),
    tool: tool.name,
    tool_version: tool.version,
    verified_at: nowIso,
    result: ok ? "passed" : "failed",
    ...pick({ commit_sha: commitSha }, ["commit_sha"]),
    ...pick(record, ["pact_file", "pact_sha256"]),
    interactions: { total: interactions.length, passed, failed: interactions.length - passed },
  };
}

/** 結果ファイルが無いとき（検証が走らなかった）。consumer 名は分からないので path を残す。 */
export function notRunConsumerContract(path, { nowIso, commitSha }) {
  return {
    consumer: null,
    provider: null,
    tool: null,
    tool_version: null,
    verified_at: nowIso,
    result: "not_run",
    commit_sha: commitSha ?? null,
    pact_file: null,
    pact_sha256: null,
    interactions: { total: 0, passed: 0, failed: 0 },
    note: `${path} が無い`,
  };
}

/** 空行 + 1 件 1 行。無ければ何も出さない。 */
export function renderConsumerContractLines(contracts) {
  if (!contracts?.length) return [];
  return [
    "",
    ...contracts.map(
      (c) =>
        `- consumer contract: ${c.consumer ?? "(不明)"} → ${c.provider ?? "(不明)"}（${c.tool ?? "-"} ${c.tool_version ?? ""}）` +
        ` ${c.result}（${c.interactions.passed}/${c.interactions.total} interaction）`,
    ),
  ];
}
