// docs-check の各検査。どれも { id, title, status: pass|fail|skipped, messages[] } を返す。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { parseCsvObjects } from "./csv.mjs";
import { exists, isFile, readText, walkFiles } from "./repo-fs.mjs";
import { parseYaml } from "./yaml-lite.mjs";

const ID_PREFIXES = "REQ|RISK|VIEW|TC|UNK|DS|EXEC|DEF|ACT|FND|EV";
const ID_RE = new RegExp(`\\b(?:${ID_PREFIXES})-\\d+\\b`, "g");
const ID_ONLY = new RegExp(`^(?:${ID_PREFIXES})-\\d+$`);
const TEST_ID_RE = /\[(TC-\d{3})\]/g;
const TEST_DIRS = ["backend/test", "frontend/test", "e2e/tests", "e2e/compose"];
const TEST_EXT = /\.(?:[cm]?[jt]s|tsx?)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const resultFor =
  (id, title) =>
  (status, messages = [], extra = {}) => ({ id, title, status, messages, ...extra });
const verdict = (messages) => (messages.length ? "fail" : "pass");

// ① docs/data/*.csv の ID 参照 --------------------------------------------------------------
function readTables(root, files) {
  return files.map((file) => {
    const { header, rows } = parseCsvObjects(readText(root, file));
    return { file, rows, idCol: header.find((h) => h === "id" || h.endsWith("_id")) ?? header[0] };
  });
}

const definedIds = (tables) =>
  new Set(tables.flatMap((t) => t.rows.map((r) => r[t.idCol]).filter((v) => ID_ONLY.test(v ?? ""))));

const rowRefs = (t, r) =>
  Object.entries(r).flatMap(([col, v]) =>
    [...v.matchAll(ID_RE)].map((m) => ({ id: m[0], where: `${t.file} ${r[t.idCol] ?? "?"}.${col}` })),
  );

const collectRefs = (tables) => tables.flatMap((t) => t.rows.flatMap((r) => rowRefs(t, r)));

export function checkIdReferences(root) {
  const title = "docs/data の ID 参照が解決する（REQ/RISK/VIEW/TC/UNK/DS/EXEC/DEF/ACT/FND/EV）";
  const result = resultFor("id-references", title);
  const files = walkFiles(root, "docs/data", (p) => p.endsWith(".csv"));
  if (files.length === 0) return result("skipped", ["docs/data/*.csv が無い"]);
  const tables = readTables(root, files);
  const defined = definedIds(tables);
  const refs = collectRefs(tables);
  const bad = [
    ...new Set(refs.filter((r) => !defined.has(r.id)).map((r) => `未解決: ${r.id}（${r.where}）`)),
  ];
  const stats = {
    files: files.length,
    defined: defined.size,
    references: refs.length,
    unresolved: bad.length,
  };
  return result(verdict(bad), bad, { stats });
}

// ② docs/evidence/manifest.json の sha256 ---------------------------------------------------
function manifestEntries(m) {
  if (Array.isArray(m)) return m;
  const v = ["files", "entries", "artifacts", "items"].map((k) => m?.[k]).find(Boolean);
  if (Array.isArray(v)) return v;
  return v ? Object.entries(v).map(([path, sha256]) => ({ path, sha256 })) : [];
}

const entryPath = (e) => e.path ?? e.file ?? e.name;
const entrySha = (e) => String(e.sha256 ?? e.hash ?? "").replace(/^sha256:/, "");
const sha256File = (root, rel) =>
  createHash("sha256")
    .update(readFileSync(join(root, rel)))
    .digest("hex");

function verifyEntry(root, e) {
  const p = entryPath(e);
  const found = [join("docs/evidence", p), p].find((c) => isFile(root, c));
  if (!found) return `ファイルが無い: ${p}`;
  return sha256File(root, found) === entrySha(e) ? null : `sha256 不一致: ${p}`;
}

export function checkManifest(root) {
  const title = "docs/evidence/manifest.json の sha256 が一致する（改変検知）";
  const result = resultFor("evidence-manifest", title);
  const mpath = "docs/evidence/manifest.json";
  if (!isFile(root, mpath)) {
    return result("skipped", [`${mpath} が無い（未作成のためスキップ）`]);
  }
  const entries = manifestEntries(JSON.parse(readText(root, mpath)));
  const msgs = entries.map((e) => verifyEntry(root, e)).filter(Boolean);
  if (entries.length === 0) msgs.push("manifest にファイルの記載が 1 件も無い");
  return result(verdict(msgs), msgs, { stats: { entries: entries.length } });
}

// ③ テスト名の [TC-xxx] ↔ cases.csv --------------------------------------------------------
const PARAM_ID_RE = /\btc:\s*["'](TC-\d{3})["']/g;

// テスト名に直接書かれた [TC-xxx] と、パラメータ化したテスト（名前が `[${tc}]` のテンプレート）の `tc: "TC-xxx"` を拾う。
export function idsInSource(text) {
  const direct = [...text.matchAll(TEST_ID_RE)].map((m) => m[1]);
  const templated = text.includes("`[${") ? [...text.matchAll(PARAM_ID_RE)].map((m) => m[1]) : [];
  return [...direct, ...templated];
}

export function collectTestIds(root) {
  const found = new Map();
  const files = TEST_DIRS.flatMap((d) => walkFiles(root, d, (p) => TEST_EXT.test(p)));
  for (const f of files) {
    for (const id of idsInSource(readText(root, f))) found.set(id, [...(found.get(id) ?? []), f]);
  }
  return found;
}

function validateGap(g, today) {
  const id = g.test_case_id ?? "(id なし)";
  const missing = ["test_case_id", "reason", "owner", "expires_at"].filter((k) => !g[k]);
  if (missing.length) return `known-gaps: ${id} に ${missing.join(",")} が無い`;
  if (!DATE_RE.test(String(g.expires_at))) return `known-gaps: ${id} の expires_at が日付でない`;
  if (String(g.expires_at) < today)
    return `known-gaps: ${id} の期限切れ（${g.expires_at}）。テストを足すか、理由付きで期限を更新する`;
  return null;
}

export function loadKnownGaps(root, today) {
  const path = "quality/known-gaps.yaml";
  if (!isFile(root, path)) return { gaps: new Map(), problems: [] };
  const list = (parseYaml(readText(root, path)) ?? {}).gaps ?? [];
  const checked = list.map((g) => [g, validateGap(g, today)]);
  return {
    gaps: new Map(checked.filter(([, p]) => !p).map(([g]) => [g.test_case_id, g])),
    problems: checked.map(([, p]) => p).filter(Boolean),
  };
}

function coverageMessages({ rows, found, gaps, problems }) {
  const known = new Set(rows.map((r) => r.test_case_id));
  const automated = rows.filter((r) => r.automation_layer !== "manual").map((r) => r.test_case_id);
  const msgs = [...problems];
  for (const id of found.keys())
    if (!known.has(id)) msgs.push(`cases.csv に無い ID: ${id}（${found.get(id)[0]}）`);
  const uncovered = automated.filter((id) => !found.has(id) && !gaps.has(id));
  if (uncovered.length)
    msgs.push(`テスト未対応の自動化ケース ${uncovered.length} 件: ${uncovered.join(", ")}`);
  return { msgs, automated };
}

export function checkTestCoverage(root, today) {
  const title = "テストの [TC-xxx] が cases.csv に実在し、自動化ケースが 1 つ以上のテストに対応する";
  const result = resultFor("tc-coverage", title);
  const casesPath = "docs/data/cases.csv";
  if (!isFile(root, casesPath)) return result("skipped", [`${casesPath} が無い`]);
  if (!["backend", "frontend", "e2e"].some((w) => exists(root, `${w}/package.json`))) {
    return result("skipped", ["backend / frontend / e2e がまだ無い（テストコード不在）"]);
  }
  const { rows } = parseCsvObjects(readText(root, casesPath));
  const found = collectTestIds(root);
  const { gaps, problems } = loadKnownGaps(root, today);
  const { msgs, automated } = coverageMessages({ rows, found, gaps, problems });
  const warnings = [...gaps.keys()]
    .filter((id) => found.has(id))
    .map((id) => `known-gaps に載っているが対応テストがある（台帳から外す）: ${id}`);
  const covered = automated.filter((i) => found.has(i)).length;
  const stats = {
    cases: rows.length,
    automated: automated.length,
    covered,
    known_gaps: gaps.size,
    test_ids: found.size,
  };
  return result(verdict(msgs), msgs, { warnings, stats });
}

// ④ Markdown の相対リンク ------------------------------------------------------------------
const stripCode = (md) => md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
const LINK_RE = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)|^\[[^\]]+\]:\s*(\S+)/gm;
const isExternal = (t) => /^[a-z][a-z0-9+.-]*:/i.test(t);

function brokenLinksIn(root, file) {
  const out = [];
  for (const m of stripCode(readText(root, file)).matchAll(LINK_RE)) {
    const raw = m[1] ?? m[2];
    const target = raw.split("#")[0];
    if (!target || isExternal(target)) continue;
    const resolved = normalize(
      target.startsWith("/") ? target.slice(1) : join(dirname(file), decodeURI(target)),
    );
    if (!exists(root, resolved)) out.push(`リンク切れ: ${file}: ${raw}`);
  }
  return out;
}

export function checkMarkdownLinks(root) {
  const title = "Markdown の相対パスリンクが切れていない";
  const result = resultFor("markdown-links", title);
  const files = walkFiles(root, ".", (p) => p.endsWith(".md") && !p.startsWith("spec/"));
  const broken = files.flatMap((f) => brokenLinksIn(root, f));
  return result(verdict(broken), broken, { stats: { files: files.length, broken: broken.length } });
}
