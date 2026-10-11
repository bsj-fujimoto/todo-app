// リリースのノート・デプロイマーカーの組み立ての単体テスト。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deployMarker, imageRows, renderNotes, verifyCommands } from "../ci/lib/release-notes.mjs";

const digest = (c) => `sha256:${c.repeat(64)}`;
const rows = imageRows({ backend: digest("a"), frontend: digest("b") }, "v1.2.3", "abc1234");

describe("release-notes", () => {
  it("イメージは digest 固定の参照と、版・sha- のタグを持つ", () => {
    assert.equal(rows[0].ref, `ghcr.io/bsj-fujimoto/todo-app-backend@${digest("a")}`);
    assert.deepEqual(rows[0].tags, ["v1.2.3", "sha-abc1234"]);
  });

  it("検証コマンドは cosign verify（release.yml の署名者を指定）と gh attestation verify", () => {
    const cmds = verifyCommands(rows, "bsj-fujimoto/todo-app");
    assert.equal(cmds.length, 4);
    assert.match(cmds[0], /cosign verify .*release\.yml@.*token\.actions\.githubusercontent\.com/);
    assert.match(cmds[1], /gh attestation verify oci:\/\/ghcr\.io\/bsj-fujimoto\/todo-app-backend@sha256:/);
  });

  it("デプロイマーカーは commit・digest・run を持ち、公開しない dry-run では released_at が null", () => {
    const base = {
      version: "v1.2.3",
      sha: "f".repeat(40),
      rows,
      runUrl: "https://example.test/run/1",
      nowIso: "2026-10-11T00:00:00Z",
    };
    assert.equal(deployMarker({ ...base, publish: true }).released_at, "2026-10-11T00:00:00Z");
    const dry = deployMarker({ ...base, publish: false });
    assert.equal(dry.released_at, null);
    assert.equal(dry.images.backend.digest, digest("a"));
    assert.equal(dry.commit_sha, "f".repeat(40));
  });

  it("リリースノートに対象 commit・イメージ digest・実行 run・検査結果を書く", () => {
    const summary = { layers: { unit: { total: 3, passed: 3, failed: 0, skipped: 0 } } };
    const gate = { result: "pass", total: 2, by_severity: "low 2" };
    const notes = renderNotes({
      version: "v1.2.3",
      sha: "f".repeat(40),
      repo: "bsj-fujimoto/todo-app",
      runUrl: "https://example.test/run/1",
      rows,
      summary,
      gate,
      publish: true,
    });
    assert.match(notes, /対象 commit: \[`f{40}`\]/);
    assert.ok(notes.includes(digest("a")));
    assert.ok(notes.includes("https://example.test/run/1"));
    assert.match(notes, /\| unit \| 3 \| 3 \| 0 \| 0 \|/);
    assert.match(notes, /ゲート \*\*pass\*\*/);
    assert.ok(!notes.includes("dry-run"));
  });
});
