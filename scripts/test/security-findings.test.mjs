// findings の補正（CodeQL の拡張ルール・trivy のイメージ・同一指紋）の単体テスト。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findingsFromSarif } from "../security/lib/findings.mjs";
import { dedupe, mergeSameFingerprint } from "../security/lib/triage.mjs";
import { zapToSarif } from "../security/lib/zap.mjs";

const sarif = (results, driver = { name: "Trivy" }) => ({
  version: "2.1.0",
  runs: [{ tool: { driver }, results }],
});
const res = (ruleId, extra = {}) => ({
  ruleId,
  level: "warning",
  message: { text: `${ruleId} の説明` },
  locations: [
    { physicalLocation: { artifactLocation: { uri: "package-lock.json" }, region: { startLine: 3 } } },
  ],
  ...extra,
});
const base = {
  tool: "trivy",
  scan: "s",
  category: "sca",
  rule_id: "CVE-2026-0001",
  severity: "high",
  location: "x",
  component: "foo",
  advisories: ["CVE-2026-0001"],
};

describe("findings の補正", () => {
  it("CodeQL のルールは driver ではなく extensions にある。そこから security-severity を読む", () => {
    const doc = {
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: { name: "CodeQL", rules: [] },
            extensions: [
              {
                name: "codeql/javascript-queries",
                rules: [{ id: "js/file-system-race", properties: { "security-severity": "7.7" } }],
              },
            ],
          },
          results: [res("js/file-system-race")],
        },
      ],
    };
    const [f] = findingsFromSarif(doc, { scan: "codeql", check_kind: "sast" });
    assert.equal(f.severity, "high");
    assert.equal(f.tool, "codeql");
  });

  it("trivy の message から部品・版を取り、イメージの場所は一時ファイルでなくイメージ名にする", () => {
    const text =
      "Package: zlib\nInstalled Version: 1.3.2-r0\nVulnerability CVE-2026-0001\nSeverity: MEDIUM\nFixed Version: 1.3.2-r1\nLink: x";
    const result = res("CVE-2026-0001", { level: "error", message: { text } });
    result.locations[0].physicalLocation = {
      artifactLocation: { uri: "security-results/x/backend-image.tar" },
    };
    const meta = { scan: "trivy-image-backend", check_kind: "container", image: "todo-app-backend:ci" };
    const [f] = findingsFromSarif(sarif([result]), meta);
    assert.equal(f.component, "zlib");
    assert.equal(f.location, "todo-app-backend:ci");
    assert.equal(f.fixed_version, "1.3.2-r1");
    assert.equal(f.installed_version, "1.3.2-r0");
  });

  it("別名は ID と参照 URL だけから拾い、本文に出てくる別の CVE で別の脆弱性を dup にしない", () => {
    const a = res("CVE-2026-0001", { message: { text: "関連: CVE-2026-0002" } });
    const b = res("CVE-2026-0002");
    const found = findingsFromSarif(sarif([a, b]), { scan: "s", check_kind: "sca" }).map((f) => ({
      ...f,
      component: "foo",
      fingerprint: f.rule_id,
    }));
    assert.equal(dedupe(found).filter((f) => f.duplicate_of).length, 0);
  });

  it("同じ指紋（baseline と API 走査が同じ ZAP アラートを出す）は 1 件にまとめ、出どころを残す", () => {
    const merged = mergeSameFingerprint([
      { ...base, fingerprint: "z", source_file: "zap-baseline.sarif" },
      { ...base, fingerprint: "z", source_file: "zap-api.sarif" },
      { ...base, fingerprint: "y", source_file: "zap-api.sarif" },
    ]);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged[0].also_in, ["zap-api.sarif"]);
  });

  it("ZAP は alertRef をルール ID にして、同じプラグインの別の指摘を区別する", () => {
    const alert = (ref) => ({
      pluginid: "10049",
      alertRef: ref,
      name: "Storable",
      riskcode: "0",
      riskdesc: "Info",
      instances: [],
    });
    const report = {
      site: [{ "@name": "http://localhost:8080", alerts: [alert("10049-1"), alert("10049-3")] }],
    };
    const { sarif: s } = zapToSarif(report, new Map());
    assert.deepEqual(
      s.runs[0].results.map((r) => r.ruleId),
      ["10049-1", "10049-3"],
    );
  });
});
