// リリースの記録（docs/evidence/release.json）の検査と、check-evidence に渡す版の固定。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { releasePlan, releaseRecordCheck, validateReleaseRecord } from "../lib/release-record.mjs";

const X = "a".repeat(40);
const good = {
  release: "v1.0.0",
  tag: "v1.0.0",
  commit_sha: X,
  images: { backend: `sha256:${"b".repeat(64)}`, frontend: `sha256:${"c".repeat(64)}` },
  run_id: 38128562945,
  recorded_at: "2026-10-11T10:00:00Z",
};
const present = (data) => ({ exists: true, data, error: null });
const absent = { exists: false, data: null, error: null };

describe("release.json の形式", () => {
  it("正しい記録は問題なし", () => assert.deepEqual(validateReleaseRecord(good), []));

  it("版・タグ・commit・digest・run・日時の不備を検出する", () => {
    assert.equal(
      validateReleaseRecord({ ...good, release: "1.0" }).length,
      1 + 1,
      "release の形と tag との不一致",
    );
    assert.equal(validateReleaseRecord({ ...good, commit_sha: "abc" }).length, 1);
    assert.equal(validateReleaseRecord({ ...good, images: { backend: "sha256:x" } }).length, 2);
    assert.equal(validateReleaseRecord({ ...good, run_id: "x" }).length, 1);
    assert.equal(validateReleaseRecord({ ...good, recorded_at: "いつか" }).length, 1);
  });
});

describe("版の固定（releasePlan）", () => {
  it("release.json が無ければ従来どおり（版を固定せず、非 strict）", () => {
    assert.deepEqual(releasePlan({ record: absent }), { release: null, strict: false, source: null });
  });

  it("release.json があれば、その commit_sha を --release に、strict で検査する", () => {
    const plan = releasePlan({ record: present(good) });
    assert.equal(plan.release, X);
    assert.equal(plan.strict, true);
  });

  it("--release の指定が優先。不正な release.json は版を固定しない（形式の失敗で止まる）", () => {
    assert.equal(releasePlan({ record: present(good), releaseArg: "f".repeat(40) }).release, "f".repeat(40));
    const bad = releasePlan({ record: present({ ...good, commit_sha: "x" }) });
    assert.deepEqual([bad.release, bad.strict], [null, false]);
  });

  it("--structure-only（release.yml）は、release.json があっても版を固定しない", () => {
    const plan = releasePlan({ record: present(good), structureOnly: true });
    assert.deepEqual([plan.release, plan.strict], [null, false]);
  });
});

describe("check-evidence の 1 項目（releaseRecordCheck）", () => {
  it("無ければスキップと理由、あれば形式で pass / fail、構造検査のみならスキップ", () => {
    assert.equal(releaseRecordCheck(absent, releasePlan({ record: absent }), false).status, "skipped");
    assert.match(
      releaseRecordCheck(absent, releasePlan({ record: absent }), false).messages[0],
      /release\.json が無い/,
    );
    const ok = present(good);
    assert.equal(releaseRecordCheck(ok, releasePlan({ record: ok }), false).status, "pass");
    const ng = present({ ...good, tag: "x" });
    assert.equal(releaseRecordCheck(ng, releasePlan({ record: ng }), false).status, "fail");
    assert.equal(
      releaseRecordCheck(ok, releasePlan({ record: ok, structureOnly: true }), true).status,
      "skipped",
    );
    const broken = { exists: true, data: null, error: "JSON として読めない" };
    assert.equal(releaseRecordCheck(broken, releasePlan({ record: broken }), false).status, "fail");
  });
});
