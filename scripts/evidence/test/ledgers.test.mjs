// 証拠索引・manifest（改変検知）・抽出パリティ・秘密情報の検査。一時ディレクトリと合成データで確かめる。
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createReport, sha256 } from "../lib/common.mjs";
import { checkEvidenceIndex } from "../lib/evidence-checks.mjs";
import { collectEvidenceEntries, describeFile } from "../lib/evidence-files.mjs";
import { createRegistry } from "../lib/evidence-registry.mjs";
import {
  buildManifest,
  buildManifestFiles,
  readManifest,
  sameFiles,
  verifyManifest,
} from "../lib/manifest.mjs";
import { checkParity, countClaims } from "../lib/parity.mjs";
import { scanFiles, scanText } from "../lib/sensitive.mjs";
import { useTmpCleanup, tmp, put, evidenceTree } from "./helpers.mjs";
import { describe, it } from "node:test";

useTmpCleanup();

describe("証拠索引の採番", () => {
  it("同じ（参照, 主張）は同じ EV を保ち、新しいものは次の番号。unreferenced は prune で落とせる", () => {
    const a = {
      claim: "TC-001 は pass",
      ref: "./a#TC-001",
      domain: "execution",
      criterion_id: "execution-06",
      type: "junit",
      sha256: "1",
      captured_at: "t",
      head_sha: "h",
    };
    const first = createRegistry();
    assert.equal(first.allocate(a), "EV-0001");
    assert.equal(first.allocate({ ...a, claim: "別" }), "EV-0002");
    const again = createRegistry(first.rows());
    assert.equal(again.allocate({ ...a, sha256: "2" }), "EV-0001");
    assert.equal(again.get("EV-0001").sha256, "2");
    assert.equal(again.allocate({ ...a, ref: "./b" }), "EV-0003");
    again.prune((row) => row.evidence_id === "EV-0002");
    assert.deepEqual(
      again.rows().map((r) => r.evidence_id),
      ["EV-0002"],
    );
  });
});

describe("manifest（改変検知）", () => {
  it("全ファイルを記録し、改変・欠落・未登録・取得元の欠けを検出する。内容が同じなら書き換えない", () => {
    const root = evidenceTree();
    const files = buildManifestFiles(root);
    assert.deepEqual(
      files.map((f) => f.path),
      [
        "runs/1/SOURCE.json",
        "runs/1/ci-summary.json",
        "runs/1/junit/e2e-chromium-junit.xml",
        "security/SOURCE.json",
        "security/security-findings/findings.json",
        "security/security-scan-sast/codeql/scan-run.json",
      ],
    );
    assert.deepEqual(Object.keys(files[1]), [
      "path",
      "sha256",
      "size",
      "captured_at",
      "source",
      "version",
      "head_sha",
    ]);
    const manifest = buildManifest(files, "2026-10-11T09:00:00.000Z");
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    assert.deepEqual(verifyManifest(root, manifest), []);
    assert.equal(sameFiles(readManifest(root), files), true);

    put(root, "runs/1/ci-summary.json", '{"layers":{"x":1}}'); // 改変
    put(root, "runs/1/new.json", "{}"); // 未登録
    rmSync(join(root, "security/security-scan-sast/codeql/scan-run.json")); // 欠落
    const problems = verifyManifest(root, manifest).join("\n");
    assert.match(problems, /sha256 不一致（改変の疑い）: runs\/1\/ci-summary.json/);
    assert.match(problems, /サイズ不一致: runs\/1\/ci-summary.json/);
    assert.match(problems, /未登録: runs\/1\/new.json/);
    assert.match(problems, /欠落: security\/security-scan-sast\/codeql\/scan-run.json/);
  });

  it("後の run に置き換えられた run（SOURCE.json の superseded_by）の項目は、置き換えた run の id を持つ", () => {
    const root = evidenceTree();
    const source = JSON.parse(readFileSync(join(root, "runs/1/SOURCE.json"), "utf8"));
    put(
      root,
      "runs/1/SOURCE.json",
      JSON.stringify({
        ...source,
        superseded_by: { run_id: "9", reason: "版の取替", marked_at: "2026-10-12" },
      }),
    );
    const files = buildManifestFiles(root);
    const by = new Map(files.map((f) => [f.path, f.superseded_by]));
    assert.equal(by.get("runs/1/ci-summary.json"), "9");
    assert.equal(by.get("runs/1/SOURCE.json"), "9");
    assert.equal(by.get("security/SOURCE.json"), undefined);
  });

  it("取得元（SOURCE.json）の無いファイルは管理対象にできない", () => {
    const root = tmp();
    put(root, "perf/result.json", "{}");
    assert.throws(() => buildManifestFiles(root), /SOURCE.json が無い/);
  });

  it("scripts/ci/lib/docs-checks.mjs の checkManifest が読める形（files[].path・sha256）", () => {
    const root = evidenceTree();
    const m = buildManifest(buildManifestFiles(root), "t");
    for (const e of m.files) assert.equal(sha256(Buffer.from(JSON.stringify(e))).length, 64);
    assert.ok(Array.isArray(m.files) && m.files.every((e) => e.path && /^[0-9a-f]{64}$/.test(e.sha256)));
  });
});

describe("証拠索引の項目と検査", () => {
  it("run 全体・セキュリティの証拠を、領域・観点・アンカーつきで作る（JUnit・観察値は実施表側）", () => {
    const root = evidenceTree();
    const entries = collectEvidenceEntries(root);
    const byRef = new Map(entries.map((e) => [e.ref, e]));
    assert.equal(byRef.get("./docs/evidence/runs/1/ci-summary.json").criterion_id, "execution-10");
    assert.equal(
      byRef.get("./docs/evidence/security/security-scan-sast/codeql/scan-run.json").criterion_id,
      "inspection-01",
    );
    const finding = byRef.get("./docs/evidence/security/security-findings/findings.json#F-001");
    assert.match(finding.claim, /^FND-001: medium trivy CVE-1 zlib（status accepted）/);
    assert.equal(describeFile("runs/1/junit/e2e-chromium-junit.xml"), null);
    assert.equal(describeFile("security/SOURCE.json"), null);
  });

  it("解決しない参照・sha256 の不一致・アンカーの不一致は失敗にする", () => {
    const root = tmp();
    put(root, "docs/evidence/runs/1/junit/e2e-junit.xml", '<testcase name="[TC-016] x"/>');
    const sha = sha256(Buffer.from('<testcase name="[TC-016] x"/>'));
    const row = (ref, sha256v) => ({
      evidence_id: "EV-0001",
      claim: "c",
      ref,
      domain: "execution",
      criterion_id: "execution-06",
      type: "junit",
      sha256: sha256v,
      captured_at: "t",
      head_sha: "h",
    });
    const run = (r) => {
      const report = createReport();
      checkEvidenceIndex(root, [r], report);
      return report.errors.join("\n");
    };
    assert.equal(run(row("./docs/evidence/runs/1/junit/e2e-junit.xml#TC-016", sha)), "");
    assert.match(run(row("./docs/evidence/runs/1/junit/e2e-junit.xml#TC-999", sha)), /アンカーが解決しない/);
    assert.match(
      run(row("./docs/evidence/runs/1/junit/e2e-junit.xml#TC-016", "0".repeat(64))),
      /sha256 が一致しない/,
    );
    assert.match(run(row("./docs/evidence/runs/2/none.xml", sha)), /参照先のファイルが無い/);
    assert.equal(run(row("https://github.com/o/r/actions/runs/1", "")), "");
  });
});

describe("抽出パリティ・秘密情報の検査", () => {
  const t = (n, header = ["a"]) => ({
    header,
    rows: Array.from({ length: n }, () => ({ applicability: "applicable", status: "ready" })),
  });

  it("md の「N 件（PREFIX）」と表の行数、列の記載を突き合わせ、不一致を検出する", () => {
    const md = "ケース 77 件（TC）。要求 34 件（REQ）、観点 69 行（VIEW）。`cases.csv` の列: `a`, `b`。";
    assert.deepEqual(
      countClaims(md).map((c) => [c.prefix, c.count]),
      [
        ["TC", 77],
        ["REQ", 34],
        ["VIEW", 69],
      ],
    );
    const ok = checkParity(
      { "docs/x.md": md },
      { cases: t(77, ["a", "b"]), requirements: t(34), perspectives: t(69) },
    );
    assert.deepEqual(ok.problems, []);
    const ng = checkParity(
      { "docs/x.md": md },
      { cases: t(76, ["a"]), requirements: t(34), perspectives: t(69) },
    );
    assert.match(ng.problems.join("\n"), /「77 件（TC）」だが cases.csv は 76 行/);
    assert.match(ng.problems.join("\n"), /cases.csv の列の記載が実際の列と違う/);
  });

  it("メール・トークン・秘密鍵を検出し、値は伏せる。UUID の 0 の並びは電話番号として数えない", () => {
    // 秘密情報らしい文字列は実行時に組み立てる（ソースに書くと、リポジトリ自身の gitleaks 検査が検出してしまう）
    const assignment = `${["to", "ken"].join("")} = "${["abcdef", "0123456789"].join("")}"`;
    const header = `-----BEGIN ${["RSA", "PRIVATE", "KEY"].join(" ")}-----`;
    const hits = scanText(
      `連絡: someone@example.org\n${assignment}\n${header}\nid 00000000-0000-4000-8000-000000000001`,
    );
    assert.deepEqual(
      hits.map((h) => [h.line, h.rule]),
      [
        [1, "email"],
        [2, "assignment"],
        [3, "private-key"],
      ],
    );
    assert.ok(hits.every((h) => !h.sample.includes("someone")));
    const { hits: none, qcCompat } = scanFiles([
      { path: "docs/data/x.csv", text: "00000000-0000-4000-8000-000000000001" },
    ]);
    assert.deepEqual(none, []);
    assert.equal(qcCompat.get("docs/data/x.csv"), 1);
    // 許可リストの例外は無い。SBOM のメンテナのメールも、墨消ししない限り検出する
    assert.deepEqual(
      scanFiles([{ path: "a/sbom.cdx.json", text: "maintainer@alpinelinux.org" }]).hits.map((h) => h.rule),
      ["email"],
    );
  });
});
