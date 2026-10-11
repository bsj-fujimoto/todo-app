// リリース証跡の墨消しと検査（scripts/ci/lib/release-redact.mjs・release-check.mjs）の単体テスト。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { checkReleaseFiles } from "../ci/lib/release-check.mjs";
import { buildManifest, redactRelease, releaseFiles } from "../ci/lib/release-redact.mjs";
import { readTree } from "../ci/lib/release-zip.mjs";

const dirs = [];
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "release-redact-test-"));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const sarif = JSON.stringify(
  {
    runs: [
      {
        results: [
          {
            partialFingerprints: {
              author: "Some Person",
              email: "some.person@example.com",
              commitSha: "0123456789abcdef",
            },
          },
        ],
      },
    ],
  },
  null,
  2,
);
const files = {
  "RELEASE_NOTES.md":
    "# v1\n担当: @someone と some.person@example.com。https://github.com/octo/repo は URL なので残す\n",
  "security-scan-secrets/gitleaks/gitleaks.sarif": sarif,
  "security-scan-dast/zap/zap.json": JSON.stringify({ "@version": "2.17.0", "@generated": "x" }, null, 2),
  "images.json": '{"images":[]}\n',
};

function build(extra = {}) {
  const dir = fixture({ ...files, ...extra });
  const records = redactRelease(dir, ["octo"]);
  const manifest = buildManifest({ dir, version: "v1.0.0", sha: "f".repeat(40), records });
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, records, manifest };
}

describe("リリース証跡の墨消し", () => {
  it("氏名・メール・メンションを置き換え、URL・コミット SHA は残す", () => {
    const { dir, records } = build();
    const notes = readFileSync(join(dir, "RELEASE_NOTES.md"), "utf8");
    assert.ok(!notes.includes("someone") && !notes.includes("example.com"));
    assert.ok(notes.includes("https://github.com/octo/repo"));
    const doc = readFileSync(join(dir, "security-scan-secrets/gitleaks/gitleaks.sarif"), "utf8");
    assert.ok(!doc.includes("Some Person") && !doc.includes("example.com"));
    assert.ok(doc.includes("0123456789abcdef"));
    assert.deepEqual(records.map((r) => r.path).sort(), [
      "RELEASE_NOTES.md",
      "security-scan-secrets/gitleaks/gitleaks.sarif",
    ]);
  });

  it("manifest に redacted: true・元 sha256・墨消し後 sha256・件数を残し、files の sha256 は墨消し後", () => {
    const { manifest, records } = build();
    assert.equal(manifest.redacted, true);
    assert.equal(manifest.redaction.files_changed, 2);
    assert.equal(
      manifest.redaction.replacements,
      records.reduce((n, r) => n + r.count, 0),
    );
    for (const r of manifest.redactions) {
      assert.match(r.original_sha256, /^[0-9a-f]{64}$/);
      assert.notEqual(r.original_sha256, r.redacted_sha256);
      assert.equal(manifest.files.find((f) => f.path === r.path).sha256, r.redacted_sha256);
    }
    assert.ok(!manifest.files.some((f) => f.path === "manifest.json"));
  });

  it("決定的（同じ入力から同じ墨消し・同じ manifest）", () => {
    const a = build();
    const b = build();
    assert.deepEqual(a.manifest, b.manifest);
  });

  it("墨消しが 1 件も無いときも redacted: true（処理を通した記録）で、件数は 0", () => {
    const dir = fixture({ "images.json": "{}\n" });
    const manifest = buildManifest({ dir, version: "v1", sha: "a", records: redactRelease(dir, []) });
    assert.equal(manifest.redacted, true);
    assert.equal(manifest.redaction.replacements, 0);
    assert.deepEqual(releaseFiles(dir), ["images.json"]);
  });
});

describe("リリース証跡の検査", () => {
  it("墨消し済みで manifest が合っていれば問題なし（ZAP の @version など JSON のキーは誤検出しない）", () => {
    const { dir } = build();
    const r = checkReleaseFiles({ files: readTree(dir), owners: ["octo"] });
    assert.deepEqual(r.problems, []);
    assert.equal(r.stats.redacted, true);
  });

  it("墨消し前の値が残っていれば検出する（値そのものは出さない）", () => {
    const dir = fixture(files);
    const manifest = buildManifest({ dir, version: "v1", sha: "a", records: [] });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    const r = checkReleaseFiles({ files: readTree(dir), owners: ["octo"] });
    assert.ok(r.problems.some((p) => /email/.test(p)));
    assert.ok(r.problems.some((p) => /personal-key:author/.test(p)));
    assert.ok(r.problems.every((p) => !p.includes("some.person@example.com") && !p.includes("Some Person")));
  });

  it("manifest の不整合（sha256 の不一致・redacted なし・manifest に無いファイル）を検出する", () => {
    const { dir } = build();
    const tree = readTree(dir);
    const tampered = new Map(tree).set("images.json", Buffer.from('{"images":["x"]}\n'));
    assert.ok(
      checkReleaseFiles({ files: tampered }).problems.some((p) => /sha256 が manifest と一致しない/.test(p)),
    );
    const extra = new Map(tree).set("extra.json", Buffer.from("{}"));
    assert.ok(checkReleaseFiles({ files: extra }).problems.some((p) => /manifest に無い/.test(p)));
    const manifest = JSON.parse(tree.get("manifest.json").toString());
    delete manifest.redacted;
    const noFlag = new Map(tree).set("manifest.json", Buffer.from(JSON.stringify(manifest)));
    assert.ok(checkReleaseFiles({ files: noFlag }).problems.some((p) => /redacted: true が無い/.test(p)));
    assert.ok(checkReleaseFiles({ files: new Map() }).problems.some((p) => /manifest.json が無い/.test(p)));
  });
});
