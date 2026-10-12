// 証拠の検査の単体テストが共有する補助（一時ディレクトリ・ファイルの書き込み・小さな証跡ツリー）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "node:test";

const dirs = [];
export function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "evidence-test-"));
  dirs.push(dir);
  return dir;
}

/** テストファイルの先頭で 1 回呼ぶ。テストごとに tmp() で作ったディレクトリを消す。 */
export function useTmpCleanup() {
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
}

export function put(root, rel, content) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** docs/evidence 相当の小さなツリー（run と security の 2 つ）。 */
export function evidenceTree() {
  const root = tmp();
  const source = (extra) =>
    JSON.stringify({
      captured_at: "2026-10-11T09:00:00.000Z",
      source_url: "https://example.test/run/1",
      head_sha: "a".repeat(40),
      version: "pre-1.0.0",
      ...extra,
    });
  put(root, "runs/1/SOURCE.json", source({ run_id: "1" }));
  put(root, "runs/1/ci-summary.json", '{"layers":{}}');
  put(root, "runs/1/junit/e2e-chromium-junit.xml", '<testcase name="[TC-001] x"/>');
  put(root, "security/SOURCE.json", source({ kind: "security", run_id: "2" }));
  put(
    root,
    "security/security-findings/findings.json",
    JSON.stringify({
      findings: [
        {
          finding_id: "F-001",
          severity: "medium",
          tool: "trivy",
          rule_id: "CVE-1",
          component: "zlib",
          status: "accepted",
        },
      ],
    }),
  );
  put(root, "security/security-scan-sast/codeql/scan-run.json", "{}");
  return root;
}
