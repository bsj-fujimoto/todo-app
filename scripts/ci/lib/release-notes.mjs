// リリースのノートと「デプロイマーカー」（どの commit のどのイメージ digest をいつ出したか）の組み立て（純粋関数）。
export const IMAGE_NAMES = {
  backend: "ghcr.io/bsj-fujimoto/todo-app-backend",
  frontend: "ghcr.io/bsj-fujimoto/todo-app-frontend",
};

const OIDC_ISSUER = "https://token.actions.githubusercontent.com";

export function imageRows(images, version, shortSha) {
  return Object.entries(images).map(([name, digest]) => ({
    name,
    repository: IMAGE_NAMES[name],
    digest,
    ref: `${IMAGE_NAMES[name]}@${digest}`,
    tags: [version, `sha-${shortSha}`],
  }));
}

export function verifyCommands(rows, repo) {
  return rows.flatMap((r) => [
    `cosign verify ${r.ref} --certificate-identity-regexp '^https://github.com/${repo}/.github/workflows/release.yml@' --certificate-oidc-issuer ${OIDC_ISSUER}`,
    `gh attestation verify oci://${r.ref} --repo ${repo}`,
  ]);
}

export function deployMarker({ version, sha, rows, runUrl, nowIso, publish }) {
  return {
    schema_version: 1,
    version,
    commit_sha: sha,
    released_at: publish ? nowIso : null,
    published: publish,
    images: Object.fromEntries(
      rows.map((r) => [r.name, { repository: r.repository, digest: r.digest, tags: r.tags }]),
    ),
    run_url: runUrl,
    note: "デプロイはしない（本リポジトリに本番は無い）。これは版情報の源（synthetic / 外形監視が /api/v1/health の version・commit と突き合わせる）。",
  };
}

const table = (header, rows) => [
  `| ${header.join(" | ")} |`,
  `|${header.map(() => "---").join("|")}|`,
  ...rows.map((r) => `| ${r.join(" | ")} |`),
];

/** 公開した digest に対する trivy の検査（scan-run.json の要約）と、その triage のゲート結果。 */
export function publishedScanLines(published) {
  if (!published?.scans?.length) return ["- 公開した digest の検査: 記録が無い"];
  const rows = published.scans.map((s) => [s.scan, `\`${s.digest ?? "?"}\``, s.status, s.findings ?? "?"]);
  return [
    ...table(["検査", "検査した digest", "実行", "SARIF の結果"], rows),
    "",
    published.gate
      ? `- ゲート **${published.gate.result}**（critical / high の未解決は失敗）。詳細は release-evidence.zip の published-scans-findings/findings.json`
      : "- ゲート: findings.json が無い",
  ];
}

const layerRows = (summary) =>
  Object.entries(summary?.layers ?? {}).map(([l, c]) => [l, c.total, c.passed, c.failed, c.skipped]);

const gateLine = (gate) =>
  gate
    ? `- セキュリティ: ゲート **${gate.result}**、検出 ${gate.total} 件（${gate.by_severity}）。詳細は release-evidence.zip の security-findings/findings.json`
    : "- セキュリティ: findings.json が無い";

const publishedSection = (published, publish) => [
  "## 公開したイメージの検査（レジストリの digest に対する trivy。脆弱性 + 設定）",
  ...(publish
    ? []
    : ["dry-run: 公開前の OCI アーカイブ（ビルド結果）に対する検査。公開されるイメージの digest ではない。"]),
  ...publishedScanLines(published),
  "",
];

export function renderNotes({ version, sha, repo, runUrl, rows, summary, gate, published, publish }) {
  const layers = layerRows(summary);
  const images = rows.map((r) => [r.name, `\`${r.ref}\``, r.tags.map((t) => `\`${t}\``).join(" ")]);
  const lines = [
    `# ${version}${publish ? "" : "（dry-run: 公開していない）"}`,
    "",
    `- 対象 commit: [\`${sha}\`](https://github.com/${repo}/commit/${sha})`,
    `- ビルドした run: ${runUrl}`,
    "- デプロイは行わない（本番環境は無い）。このリリースは、synthetic / 外形監視が参照する**版情報（デプロイマーカー）の源**。",
    "",
    publish
      ? "## イメージ（digest 固定・署名・provenance・SBOM つき）"
      : "## イメージ（dry-run: OCI アーカイブにビルドしただけ。push・署名・attest はしていない）",
    ...table(["イメージ", "参照（digest）", "タグ"], images),
    "",
    ...(publish
      ? ["検証:", "```sh", ...verifyCommands(rows, repo), "```", ""]
      : ["dry-run の digest はビルド結果の確認用で、公開されるイメージの digest ではない。", ""]),
    "## リリース前の検査結果（対象 commit）",
    ...(layers.length ? table(["層", "合計", "成功", "失敗", "スキップ"], layers) : ["- ci-summary が無い"]),
    "",
    gateLine(gate),
    "",
    ...publishedSection(published, publish),
    "## 証跡（release-evidence.zip）",
    "ci-summary.json・セキュリティの SARIF / SBOM / scan-run.json・公開した digest の検査（published-scans/）・性能（k6）の結果があればそれ・manifest.json（全ファイルの sha256）・deploy-marker.json を含む。",
  ];
  return `${lines.join("\n")}\n`;
}
