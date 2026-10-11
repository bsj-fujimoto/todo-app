// GitHub Issue（label: defect / flaky）→ docs/data/defects.csv の行。語彙を統一し、欠けている項目は検出する。純粋関数。
import { clipText } from "./observations.mjs";
import { firstWord, oneLine, parseBullets, parseSections, wordsIn } from "./issue-body.mjs";

export const DEFECT_COLUMNS = [
  "defect_id",
  "case_ids",
  "severity",
  "status",
  "function",
  "quality_attr",
  "cause_class",
  "root_cause",
  "injected_phase",
  "detected_phase",
  "could_detect_at",
  "upstream_doc",
  "repro",
  "expected",
  "actual",
  "impact",
  "evidence_ids",
  "fix_commit",
  "source",
  "release",
  "opened_at",
  "closed_at",
];

export const VOCAB = {
  severity: ["critical", "major", "minor", "trivial"],
  status: ["open", "fixed", "closed", "wontfix"],
  phase: [
    "requirements",
    "design",
    "implementation",
    "test",
    "environment",
    "review",
    "unit",
    "api",
    "e2e",
    "regression",
    "monitoring",
    "production",
  ],
  // 原因の分類（analysis.py の期待: 要求 / 設計 / 実装 / レビュー / テスト / 環境 / プロセス）
  cause_class: ["requirements", "design", "implementation", "review", "test", "environment", "process"],
  function: ["add", "list", "toggle", "delete", "validation", "storage", "api", "ui", "infra"],
  quality_attr: ["functional", "reliability", "usability", "security", "performance", "compatibility"],
};
const DETECTING = ["unit", "api", "e2e", "regression", "test", "review", "monitoring"];
const SEVERITY_ALIAS = { high: "major", medium: "major", low: "minor", blocker: "critical" };
const MAX = { text: 600, short: 400 };

export const defectId = (number) => `DEF-${String(number).padStart(3, "0")}`;
const labelsOf = (issue) => issue.labels.map((l) => (typeof l === "string" ? l : l.name));

/** Issue の状態 → status 語彙。fixed は「修正 PR がある」closed、wontfix は not_planned で閉じたもの。 */
export function statusOf(issue, fixPr) {
  if (issue.state === "OPEN") return "open";
  if (issue.stateReason === "NOT_PLANNED") return "wontfix";
  return fixPr ? "fixed" : "closed";
}

const onlyKnown = (value, vocabulary) => (vocabulary.includes(value) ? value : "");

function phaseOf(value) {
  const word = firstWord(value);
  return word === "manual" ? "test" : onlyKnown(word, VOCAB.phase);
}

/** 検出可能だった工程: 検出の手段にあたる語（unit / test / review…）があればそれ、無ければ最初の語。 */
function couldDetect(value) {
  const words = wordsIn(value, VOCAB.phase);
  return words.find((w) => DETECTING.includes(w)) ?? words[0] ?? "";
}

const caseIdsOf = (text) => [...new Set(String(text ?? "").match(/TC-\d{3}/g) ?? [])];
const fixPrOf = (value) => /#?(\d+)/.exec(value ?? "")?.[1] ?? null;

function severityOf(value) {
  const word = firstWord(value);
  return onlyKnown(SEVERITY_ALIAS[word] ?? word, VOCAB.severity);
}

/** Issue 本文から取り出した項目（まだ語彙の検査はしない）。 */
export function extractFields(issue) {
  const sections = parseSections(issue.body);
  const id = parseBullets(sections.get("識別"));
  const cause = parseBullets(sections.get("原因分類"));
  const related = parseBullets(sections.get("関連ケース / 証拠"));
  return {
    severity: severityOf(id.get("重大度")),
    function: onlyKnown(firstWord(id.get("機能")), VOCAB.function),
    quality_attr: onlyKnown(firstWord(id.get("品質特性")), VOCAB.quality_attr),
    injected_phase: phaseOf(id.get("混入工程")),
    detected_phase: phaseOf(id.get("検出工程")),
    could_detect_at: couldDetect(cause.get("検出可能だった工程")),
    cause_class: onlyKnown(firstWord(cause.get("原因分類")), VOCAB.cause_class),
    root_cause: clipText(cause.get("根本原因") ?? "", MAX.text),
    upstream_doc: (id.get("上流文書") ?? "").trim(),
    source_hint: firstWord(id.get("検出元")),
    release_hint: (id.get("リリース") ?? "").trim(),
    fix_pr: fixPrOf(cause.get("修正 PR") ?? cause.get("修正PR")),
    case_ids: caseIdsOf(related.get("ケース")),
    // 「ケース: 該当なし。…」と事実（検出した手段・ケースが無いこと）を書いた不具合は、case_ids が空でもよい（追跡表に欠落として残る）
    no_case: /^該当なし/.test(related.get("ケース") ?? ""),
    repro: clipText(oneLine(sections.get("再現手順")), MAX.text),
    expected: clipText(oneLine(sections.get("期待結果")), MAX.short),
    actual: clipText(oneLine(sections.get("実際の結果")), MAX.short),
    impact: clipText(oneLine(sections.get("影響")), MAX.short),
  };
}

/** 検出時点の版: 起票日以前で最新のリリースタグ。無ければ未リリース。releases: [{ tag, date }]。 */
export function releaseFor(createdAt, releases) {
  const before = releases.filter((r) => r.date <= createdAt).sort((a, b) => a.date.localeCompare(b.date));
  return before.at(-1)?.tag.replace(/^v/, "") ?? "pre-1.0.0";
}

const REQUIRED = [
  "severity",
  "function",
  "quality_attr",
  "cause_class",
  "root_cause",
  "injected_phase",
  "detected_phase",
  "could_detect_at",
  "upstream_doc",
  "repro",
  "expected",
  "actual",
  "impact",
];

/** Issue 本文に補筆すべき項目・解決しない参照（番号なし）。 */
function problemsOf(f, fixCommit, ctx) {
  return [
    ...REQUIRED.filter((k) => !f[k]).map((k) => `${k} が Issue 本文に無い（または語彙外）`),
    ...(f.case_ids.length === 0 && !f.no_case
      ? ["関連ケース（TC-xxx）が Issue 本文に無い（ケースが無いなら「ケース: 該当なし。…」と事実を書く）"]
      : []),
    ...f.case_ids.filter((c) => !ctx.caseIds.has(c)).map((c) => `関連ケース ${c} が cases.csv に無い`),
    ...(f.fix_pr && !fixCommit ? [`修正 PR #${f.fix_pr} のマージ commit を取得できない（未マージ）`] : []),
  ];
}

const sourceOf = (f) => f.source_hint || (f.detected_phase === "production" ? "production" : "test");
const fixCommitOf = (f, ctx) => (f.fix_pr ? (ctx.fixCommits.get(f.fix_pr) ?? "") : "");

/**
 * ctx: { releases, fixCommits: Map(PR 番号 → merge commit), evidence(issue, fields) → EV の配列, caseIds:Set }。
 * 戻り値: { row, problems }。problems は Issue 本文に補筆すべき項目・解決しない参照。
 */
export function buildDefect(issue, ctx) {
  const f = extractFields(issue);
  const fixCommit = fixCommitOf(f, ctx);
  const problems = problemsOf(f, fixCommit, ctx);
  const status = statusOf(issue, fixCommit ? f.fix_pr : null);
  const source = sourceOf(f);
  const row = {
    defect_id: defectId(issue.number),
    case_ids: f.case_ids.join(";"),
    severity: f.severity,
    status,
    function: f.function,
    quality_attr: f.quality_attr,
    cause_class: f.cause_class,
    root_cause: f.root_cause,
    injected_phase: f.injected_phase,
    detected_phase: f.detected_phase,
    could_detect_at: f.could_detect_at,
    upstream_doc: f.upstream_doc,
    repro: f.repro,
    expected: f.expected,
    actual: f.actual,
    impact: f.impact,
    evidence_ids: ctx.evidence(issue, { ...f, status }).join(";"),
    fix_commit: fixCommit,
    source,
    release: f.release_hint || releaseFor(issue.createdAt, ctx.releases),
    opened_at: issue.createdAt,
    closed_at: issue.closedAt ?? "",
  };
  if (status === "closed" && issue.state === "CLOSED")
    problems.push("closed だが修正 PR の記録が無い（修正 PR 行を補筆する）");
  return { row, problems: problems.map((p) => `#${issue.number}: ${p}`) };
}

/** defect / flaky ラベルの Issue を、番号順に重複なく。 */
export function selectIssues(issues) {
  const wanted = issues.filter((i) => labelsOf(i).some((l) => ["defect", "flaky"].includes(l)));
  return [...new Map(wanted.map((i) => [i.number, i])).values()].sort((a, b) => a.number - b.number);
}

/** 語彙・欠損の最終検査（生成後の defects.csv を check-evidence でも使う）。 */
const COLUMN_VOCAB = [
  ["severity", VOCAB.severity],
  ["status", VOCAB.status],
  ["cause_class", VOCAB.cause_class],
  ["function", VOCAB.function],
  ["quality_attr", VOCAB.quality_attr],
  ["injected_phase", VOCAB.phase],
  ["detected_phase", VOCAB.phase],
  ["could_detect_at", VOCAB.phase],
];

const rowProblems = (r) => [
  ...COLUMN_VOCAB.filter(([col, vocab]) => !vocab.includes(r[col])).map(
    ([col]) => `${col} が語彙外（${r[col]}）`,
  ),
  ...(r.status === "fixed" && !/^[0-9a-f]{40}$/.test(r.fix_commit) ? ["fixed なのに fix_commit が無い"] : []),
];

export function checkDefectRows(rows, report) {
  const ids = rows.map((r) => r.defect_id);
  for (const id of ids.filter((x, i) => ids.indexOf(x) !== i)) report.error(`${id} が重複`);
  for (const r of rows) for (const p of rowProblems(r)) report.error(`${r.defect_id}: ${p}`);
  for (const r of rows.filter((x) => !x.case_ids)) {
    report.warn(
      `${r.defect_id}: 関連ケースが無い（検出した手段: ${r.detected_phase}。新規ケースの提案は Issue に書く）`,
    );
  }
}
