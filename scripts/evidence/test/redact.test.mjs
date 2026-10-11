// 取り込み時の墨消し（人の氏名・メール・アカウント名・秘密情報らしい値）と、許可リストの例外なしの検査。合成データで確かめる。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256 } from "../lib/common.mjs";
import { buildManifestFiles } from "../lib/manifest.mjs";
import { redactFiles, redactionSection } from "../lib/redact-files.mjs";
import { redactText } from "../lib/redact.mjs";
import { personalKeyHits, scanFiles, scanText } from "../lib/sensitive.mjs";

// 実在しない人名・アドレスの合成データ
const GITLEAKS = JSON.stringify(
  {
    runs: [
      {
        results: [
          {
            partialFingerprints: {
              commitSha: "a".repeat(40),
              email: "12345+taro-sample@users.noreply.example.test",
              author: "山田 太郎",
              date: "2026-10-11T09:46:39Z",
              commitMessage: "feat: x (#1)\n\nCo-Authored-By: Hanako Sample <hanako@example.test>\n",
            },
          },
        ],
      },
    ],
  },
  null,
  2,
);

describe("墨消し（redactText）", () => {
  it("個人情報のキー（author・email）の値と、コミットメッセージの Co-Authored-By の氏名・メールを置き換える。構造と書式は保つ", () => {
    const r = redactText(`${GITLEAKS}\n`, "gitleaks.sarif");
    assert.equal(r.changed, true);
    const doc = JSON.parse(r.text);
    const fp = doc.runs[0].results[0].partialFingerprints;
    assert.deepEqual([fp.email, fp.author], ["[REDACTED:email]", "[REDACTED:author]"]);
    assert.equal(fp.commitSha, "a".repeat(40));
    assert.equal(fp.commitMessage, "feat: x (#1)\n\nCo-Authored-By: [REDACTED:author] <[REDACTED:email]>\n");
    assert.ok(r.text.startsWith('{\n  "runs"') && r.text.endsWith("}\n"), "インデントと末尾の改行を保つ");
    assert.deepEqual(
      r.counts.map((c) => c.rule),
      ["email", "key:author", "key:email", "trailer-name"],
    );
    assert.ok(!/山田|taro|hanako|Hanako/i.test(r.text));
  });

  it("決定的で、墨消し済みをもう一度かけても変わらない。置き換えが無いファイルは本文をそのまま返す", () => {
    const once = redactText(GITLEAKS, "x.json");
    assert.equal(redactText(GITLEAKS, "x.json").text, once.text);
    const again = redactText(once.text, "x.json");
    assert.deepEqual([again.changed, again.text], [false, once.text]);
    const clean = '{ "a": 1 }';
    assert.deepEqual([redactText(clean, "c.json").changed, redactText(clean, "c.json").text], [false, clean]);
  });

  it("CycloneDX: 「氏名 <メール>」の氏名とメール・email と並ぶ name を置き換え、npm のスコープ（group）と版（pkg@1.0）は残す", () => {
    const sbom = JSON.stringify({
      components: [
        { group: "@fastify", name: "avvio", version: "9.0.0", purl: "pkg:npm/%40fastify/avvio@9.0.0" },
        {
          name: "zlib",
          authors: [{ name: "Jiro Sample", email: "jiro@example.test" }],
          author: "Saburo Sample <saburo@example.test>",
        },
        { name: "pkg@1.0", description: "see @fastify/avvio and node@24" },
      ],
    });
    const out = JSON.parse(redactText(sbom, "sbom.cdx.json").text).components;
    assert.equal(out[0].group, "@fastify");
    assert.equal(out[0].purl, "pkg:npm/%40fastify/avvio@9.0.0");
    assert.deepEqual(out[1].authors, [{ name: "[REDACTED:author]", email: "[REDACTED:email]" }]);
    assert.equal(out[1].author, "[REDACTED:author]");
    assert.equal(out[2].description, "see @fastify/avvio and node@24");
  });

  it("アカウントのメンション・リポジトリのオーナー名（URL 以外）・秘密情報らしい値を置き換える。URL・owner/repo の形は残す", () => {
    const owners = ["octo-owner"];
    const text = [
      "担当は @octo-user と octo-owner。",
      "https://github.com/octo-owner/todo-app/actions/runs/1",
      "ghcr.io/octo-owner/todo-app-backend",
      "octo-owner/todo-app",
      `${["pass", "word"].join("")} = hunter2hunter2`,
    ].join("\n");
    const r = redactText(text, "note.md", owners).text.split("\n");
    assert.equal(r[0], "担当は [REDACTED:account] と [REDACTED:account]。");
    assert.deepEqual(r.slice(1, 4), [
      "https://github.com/octo-owner/todo-app/actions/runs/1",
      "ghcr.io/octo-owner/todo-app-backend",
      "octo-owner/todo-app",
    ]);
    assert.equal(r[4], "[REDACTED:secret]");
  });

  it("jsonl は 1 行ずつ、JSON として読めない JSON ファイルは文字列として置き換える", () => {
    const jsonl = '{"author":"Taro Sample","n":1}\n{"msg":"mail a@example.test"}\n';
    assert.equal(
      redactText(jsonl, "h.jsonl").text,
      '{"author":"[REDACTED:author]","n":1}\n{"msg":"mail [REDACTED:email]"}\n',
    );
    assert.equal(redactText("{ 壊れた a@example.test", "b.json").text, "{ 壊れた [REDACTED:email]");
  });
});

describe("検査（許可リストの例外なし）", () => {
  it("墨消ししていない author・email のキーを検出し、墨消し済みは通す", () => {
    const hits = personalKeyHits(GITLEAKS, "a/gitleaks.sarif");
    assert.deepEqual(hits.map((h) => h.rule).sort(), ["personal-key:author", "personal-key:email"]);
    assert.ok(hits.every((h) => !h.sample.includes("山田")));
    const redacted = redactText(GITLEAKS, "a/gitleaks.sarif").text;
    assert.deepEqual(personalKeyHits(redacted, "a/gitleaks.sarif"), []);
    assert.deepEqual(
      scanFiles([{ path: "a/gitleaks.sarif", text: redacted }], { owners: ["octo-owner"] }).hits,
      [],
    );
  });

  it("オーナー名は URL・owner/repo 以外で書かれていれば検出し、npm のスコープ・版・メールの一部はメンションとして数えない", () => {
    const owners = ["octo-owner"];
    assert.deepEqual(
      scanText("https://github.com/octo-owner/todo-app と octo-owner/todo-app", { owners }),
      [],
    );
    assert.deepEqual(
      scanText("作成: octo-owner", { owners }).map((h) => h.rule),
      ["owner-name"],
    );
    assert.deepEqual(
      scanText("担当 @octo-user", {}).map((h) => h.rule),
      ["mention"],
    );
    assert.deepEqual(scanText('"group": "@fastify" と @scope/pkg と node@24', {}), []);
  });
});

describe("取り込み時の墨消しの記録", () => {
  const dirs = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "redact-test-"));
    dirs.push(d);
    return d;
  };
  const put = (root, rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };

  it("墨消しした実ファイルについて、元と墨消し後の sha256・規則ごとの件数・理由を返し、変更の無いファイルには触れない", () => {
    const dir = tmp();
    put(dir, "a/gitleaks.sarif", GITLEAKS);
    put(dir, "a/scan-run.json", '{"ok":true}');
    const records = redactFiles(dir, ["a/gitleaks.sarif", "a/scan-run.json"], []);
    assert.equal(records.length, 1);
    const [r] = records;
    assert.equal(r.path, "a/gitleaks.sarif");
    assert.equal(r.original_sha256, sha256(Buffer.from(GITLEAKS)));
    assert.equal(r.redacted_sha256, sha256(readFileSync(join(dir, "a/gitleaks.sarif"))));
    assert.notEqual(r.original_sha256, r.redacted_sha256);
    assert.equal(r.count, 4);
    assert.match(r.reason, /氏名・メールアドレス/);
    assert.equal(readFileSync(join(dir, "a/scan-run.json"), "utf8"), '{"ok":true}');
    assert.equal(redactionSection([]).redactions.length, 0);
    assert.match(redactionSection(records).redaction_note, /original_sha256/);
  });

  it("manifest は墨消し後の sha256 を管理し、元の sha256 との対応（original_sha256）を持つ", () => {
    const dir = tmp();
    const source = {
      captured_at: "t",
      source_url: "https://example.test/run/1",
      head_sha: "a".repeat(40),
      version: "pre-1.0.0",
    };
    put(dir, "security/security-scan-secrets/gitleaks/gitleaks.sarif", GITLEAKS);
    const records = redactFiles(join(dir, "security"), ["security-scan-secrets/gitleaks/gitleaks.sarif"], []);
    put(dir, "security/SOURCE.json", JSON.stringify({ ...source, ...redactionSection(records) }));
    put(dir, "security/other.json", "{}");
    const files = buildManifestFiles(dir);
    const entry = files.find((f) => f.path.endsWith("gitleaks.sarif"));
    assert.equal(entry.sha256, records[0].redacted_sha256);
    assert.equal(entry.original_sha256, records[0].original_sha256);
    assert.equal(entry.redacted, true);
    assert.equal(files.find((f) => f.path.endsWith("other.json")).original_sha256, undefined);
  });
});
