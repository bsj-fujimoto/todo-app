// API テストの結果の機械可読な表（docs/data/api-results.csv）。純粋関数。
// 1 行 = 1 テスト（TC）× 1 endpoint × 1 method。材料は 3 つ:
//   ① backend/test/api-tags.yaml（TC → endpoint・method・タグの対応。人が決める唯一の入力）
//   ② JUnit（結果 pass / fail）と観察値（その TC が実際に呼んだ endpoint・method・status）
//   ③ テストの実装（status・header のアサート、契約スキーマ検証の有無。ソースから機械的に読む）
// 宣言したタグは、観察値に裏付けが無ければ失敗する（実際に行っていない検査をタグにしない）。
import { tcIdsOf } from "./junit-suites.mjs";

export const API_RESULT_COLUMNS = [
  "test_id",
  "endpoint",
  "method",
  "tags",
  "status",
  "schema_validated",
  "asserts_status",
  "asserts_header",
  "asserts_content_type",
  "evidence_ref",
  "run_id",
];

/** 観察値の path を契約の path テンプレートにする（タスクの id 部分を {id} に）。 */
export const normalizePath = (path) =>
  String(path)
    .split("?")[0]
    .replace(/^(\/api\/v1\/tasks)\/[^/]+$/, "$1/{id}");

// ---- ③ テストの実装の読み取り -------------------------------------------------------------

const IT_START = /^[ \t]*(?:it|test)\(\s*[`"']/gm;
const BLOCK_END = /^[ \t]*(?:it|test|describe|beforeEach|afterEach)\(/m;

/** ソースから、TC 付きのテスト（it）ごとの本文を切り出す。[{ tcs, body }]。 */
export function testBlocks(source) {
  const starts = [...source.matchAll(IT_START)].map((m) => m.index);
  return starts
    .map((at) => {
      const rest = source.slice(at);
      const firstLine = rest.indexOf("\n") + 1;
      const next = rest.slice(firstLine).search(BLOCK_END);
      const body = next === -1 ? rest : rest.slice(0, firstLine + next);
      return { tcs: tcIdsOf(body.split("\n")[0]), body };
    })
    .filter((b) => b.tcs.length > 0);
}

const STATUS_ASSERT = /\bassert(?:Spec)?Error\(|\btitlesOf\(|assert\.\w+\([\s\S]{0,200}?\.status\b/;
const HEADER_READ = /\.headers\.get\(\s*["'`]([^"'`]+)["'`]/g;

/** 1 つのテスト本文 → { status, header, contentTypeExplicit, contractOn }。 */
export function flagsOfBlock(body) {
  const headers = [...body.matchAll(HEADER_READ)].map((m) => m[1].toLowerCase());
  return {
    status: STATUS_ASSERT.test(body),
    header: headers.some((h) => h !== "content-type"),
    contentTypeExplicit: headers.includes("content-type"),
    contractOn: !/\bcontract:\s*false\b/.test(body),
  };
}

/**
 * ソース（path → 本文）から TC ごとの検査の有無を読む。同じ TC のテストが複数あるときは、すべてで成り立つときだけ true。
 * 契約検証は、テストの HTTP クライアント（helpers/harness.js）が既定で全応答に行うので、contract: false を渡さない限り有効（harnessProblems で前提を確かめる）。
 */
export function scanTestFlags(sources) {
  const perTc = new Map();
  for (const text of sources.values()) {
    for (const block of testBlocks(text)) {
      const f = flagsOfBlock(block.body);
      for (const tc of block.tcs) perTc.set(tc, [...(perTc.get(tc) ?? []), f]);
    }
  }
  return new Map(
    [...perTc.entries()].map(([tc, list]) => [
      tc,
      {
        status: list.every((f) => f.status),
        header: list.every((f) => f.header),
        schema: list.every((f) => f.contractOn),
        contentType: list.every((f) => f.contractOn || f.contentTypeExplicit),
      },
    ]),
  );
}

/** 「契約検証は既定で全応答に行われ、content-type も見る」前提がテスト基盤に残っているか。問題の配列。 */
export function harnessProblems(harnessText, contractText) {
  const problems = [];
  if (!/contract\s*=\s*true/.test(harnessText))
    problems.push("helpers/harness.js: クライアントの contract の既定値が true でない");
  if (!/contract\s*&&\s*options\.contract\s*!==\s*false\)\s*assertContract\(/.test(harnessText))
    problems.push("helpers/harness.js: 応答ごとの assertContract 呼び出しが見つからない");
  if (!/content-type/i.test(contractText))
    problems.push("helpers/contract.js: content-type の検査が見つからない");
  return problems;
}

// ---- ② 観察値による裏付け ------------------------------------------------------------------

const inRange = (s, lo, hi) => s >= lo && s <= hi;
const isOk = (s) => inRange(s, 200, 299);
const isRejected = (s) => s === 400 || s === 422;
const REPEAT = new Set(["idempotency", "concurrency"]);

/** タグごとの裏付けの規則: (呼び出しの配列) → 成り立つか。 */
const SUPPORT = {
  "error:4xx": (calls) => calls.some((c) => inRange(c.status, 400, 499)),
  "error:5xx": (calls) => calls.some((c) => inRange(c.status, 500, 599)),
  "error:error_code": (calls) => calls.some((c) => /"code":"[A-Z_]+"/.test(c.response ?? "")),
  "error:leak": (calls) => calls.some((c) => c.status >= 400),
  "error:retryable": (calls) => failedThenSucceeded(calls),
  retry: (calls) => failedThenSucceeded(calls),
  "validation:boundary": (calls) => calls.some((c) => isRejected(c.status) || isOk(c.status)),
  schema: (calls) => calls.some((c) => isOk(c.status)),
  business: (calls) => calls.some((c) => isOk(c.status) || c.status === 404 || isRejected(c.status)),
};

function failedThenSucceeded(calls) {
  const firstFail = calls.findIndex((c) => c.status >= 500);
  return firstFail !== -1 && calls.slice(firstFail + 1).some((c) => isOk(c.status));
}

/** タグ 1 つの裏付けがあるか。観察値で確かめられない（規則が無い）タグは、validation:* なら 400・422 の観察を求める。 */
export function tagSupported(tag, calls) {
  if (SUPPORT[tag]) return SUPPORT[tag](calls);
  if (REPEAT.has(tag)) return calls.length >= 2;
  if (tag.startsWith("validation:")) return calls.some((c) => isRejected(c.status));
  return calls.length > 0;
}

/** 観察 entry（api 層・backend）の呼び出し → [{ method, endpoint, status, response }]。 */
export function callsOf(entries) {
  return entries
    .filter((e) => e.layer === "api")
    .flatMap((e) => e.api_calls ?? [])
    .map((c) => ({
      method: String(c.method).toUpperCase(),
      endpoint: normalizePath(c.path),
      status: c.status,
      response: c.response,
    }));
}

// ---- 表の組み立て --------------------------------------------------------------------------

const word = (b) => (b ? "true" : "false");
const combine = (cases) => (cases.some((c) => c.status === "failed") ? "fail" : "pass");

/** TC → 結果（JUnit の pass / fail）。API 層（backend の api テスト）のケースだけ。classify: junit のケース → { layer, component }。 */
export function apiResultByTc(junitCases, classify) {
  const byTc = new Map();
  for (const c of junitCases.filter(
    (x) => classify(x).layer === "api" && classify(x).component === "backend",
  )) {
    for (const tc of tcIdsOf(c.name)) byTc.set(tc, [...(byTc.get(tc) ?? []), c]);
  }
  return new Map([...byTc.entries()].map(([tc, cases]) => [tc, combine(cases)]));
}

/** 対応表の endpoint 1 つの形式の問題。 */
const endpointFormatProblems = (t, e) => [
  ...(!e.method || !e.path ? [`api-tags.yaml: ${t.id} の endpoint に method / path が無い`] : []),
  ...(Array.isArray(e.tags) ? [] : [`api-tags.yaml: ${t.id} ${e.method} ${e.path} の tags が配列でない`]),
];

/** 対応表のテスト 1 件の形式の問題。seen は既に見たテストの ID。 */
function testFormatProblems(t, caseIds, seen) {
  const endpoints = Array.isArray(t.endpoints) ? t.endpoints : [];
  return [
    ...(seen.has(t.id) ? [`api-tags.yaml: ${t.id} が重複`] : []),
    ...(caseIds.has(t.id) ? [] : [`api-tags.yaml: ${t.id} が cases.csv に無い`]),
    ...(endpoints.length === 0 ? [`api-tags.yaml: ${t.id} に endpoints が無い`] : []),
    ...endpoints.flatMap((e) => endpointFormatProblems(t, e)),
  ];
}

/** 対応表の検査（形式）。問題の配列。 */
export function mappingProblems(mapping, caseIds) {
  const seen = new Set();
  return (mapping?.tests ?? []).flatMap((t) => {
    const problems = testFormatProblems(t, caseIds, seen);
    seen.add(t.id);
    return problems;
  });
}

/** 1 つの endpoint の行と、その問題。ctx: { tc, status, flags, calls, runId, evidenceRef }。 */
function endpointRow(e, ctx) {
  const method = String(e.method).toUpperCase();
  const mine = ctx.calls.filter((c) => c.method === method && c.endpoint === e.path);
  const where = `${ctx.tc} ${method} ${e.path}`;
  const problems = [];
  if (mine.length === 0)
    problems.push(`${where}: 観察値にこの endpoint の呼び出しが無い（api-tags.yaml が実測と合わない）`);
  for (const tag of e.tags) {
    if (mine.length > 0 && !tagSupported(tag, mine))
      problems.push(`${where}: タグ ${tag} の裏付けが観察値に無い`);
  }
  const row = {
    test_id: ctx.tc,
    endpoint: e.path,
    method,
    tags: e.tags.join(";"),
    status: ctx.status,
    schema_validated: word(ctx.flags.schema),
    asserts_status: word(ctx.flags.status),
    asserts_header: word(ctx.flags.header),
    asserts_content_type: word(ctx.flags.contentType),
    evidence_ref: ctx.evidenceRef,
    run_id: ctx.runId,
  };
  return { row, problems };
}

/** 対応表のテスト 1 件の行と問題。entries: そのテストの観察 entry。 */
function testRows(t, entries, ctx) {
  const status = ctx.statusByTc.get(t.id);
  const flags = ctx.flagsByTc.get(t.id);
  const missing = [
    ...(status ? [] : [`${t.id}: JUnit に API 層の結果が無い`]),
    ...(flags ? [] : [`${t.id}: テストの実装（backend/test/api）に [${t.id}] のテストが見つからない`]),
  ];
  if (missing.length > 0) return { rows: [], problems: missing };
  const evidenceRef = entries[0] ? `${ctx.runDir}/${entries[0]._file}` : "";
  const built = t.endpoints.map((e) =>
    endpointRow(e, { tc: t.id, status, flags, calls: callsOf(entries), runId: ctx.runId, evidenceRef }),
  );
  return {
    rows: built.map((b) => b.row),
    problems: [
      ...(evidenceRef ? [] : [`${t.id}: 観察値のファイルが無い`]),
      ...built.flatMap((b) => b.problems),
    ],
  };
}

/**
 * ctx: { mapping, statusByTc, flagsByTc, observations（component → entry[]。entry に _tc・_file）, runId（gh-run-…）, runDir（./docs/evidence/runs/<id>） }。
 * 戻り値: { rows, problems }。対応表のケースで結果・実装・観察値が無いもの、タグの裏付けが無いものは問題。
 */
export function buildApiResults(ctx) {
  const backend = ctx.observations.get("backend") ?? [];
  const parts = ctx.mapping.tests.map((t) =>
    testRows(
      t,
      backend.filter((e) => e._tc === t.id),
      ctx,
    ),
  );
  return { rows: parts.flatMap((p) => p.rows), problems: parts.flatMap((p) => p.problems) };
}

/** API 層のケース（cases.csv の automation_layer=api）で、対応表に載っていないもの。問題の配列。 */
export function uncoveredCases(cases, mapping) {
  const mapped = new Set((mapping?.tests ?? []).map((t) => t.id));
  return cases
    .filter((c) => c.automation_layer === "api" && !mapped.has(c.test_case_id))
    .map((c) => `${c.test_case_id}: API 層のケースだが api-tags.yaml に無い（api-results.csv に載らない）`);
}
