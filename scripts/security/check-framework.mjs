#!/usr/bin/env node
// Fastify の規約の機械検査（FW-001〜FW-004。ルールは scripts/security/lib/framework.mjs の先頭）。違反があれば exit 1。
//   node scripts/security/check-framework.mjs [--out security-results/framework/framework.sarif]
// frontend は React・Vue などのフレームワークを使わない（素の ES モジュール）ので、該当する規約が無い。
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import { parseArgs } from "../ci/lib/args.mjs";
import {
  RULES,
  contractProblems,
  foundationProblems,
  registrationProblems,
  replyProblems,
  routesOf,
} from "./lib/framework.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? ".");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const routeFiles = readdirSync(join(root, "backend/src/routes")).filter((f) => f.endsWith(".js"));
const routeSources = Object.fromEntries(
  routeFiles.map((f) => [`backend/src/routes/${f}`, read(`backend/src/routes/${f}`)]),
);
const appSrc = read("backend/src/app.js");

const routes = Object.entries(routeSources).flatMap(([file, src]) =>
  routesOf(src).map((r) => ({ ...r, file })),
);
const findings = [
  ...contractProblems(routes, parse(read("backend/openapi.yaml"))).map((m) => [
    "FW-001",
    "backend/openapi.yaml",
    m,
  ]),
  ...routes.flatMap((r) => replyProblems(r).map((m) => ["FW-002", r.file, m])),
  ...foundationProblems(appSrc).map((m) => ["FW-003", "backend/src/app.js", m]),
  ...registrationProblems(routeSources, appSrc).map((m) => ["FW-004", "backend/src/app.js", m]),
];

const sarif = {
  version: "2.1.0",
  $schema: "https://json.schemastore.org/sarif-2.1.0.json",
  runs: [
    {
      tool: {
        driver: {
          name: "check-framework",
          semanticVersion: "1.0.0",
          rules: Object.entries(RULES).map(([id, text]) => ({ id, name: id, shortDescription: { text } })),
        },
      },
      results: findings.map(([ruleId, uri, text]) => ({
        ruleId,
        level: "error",
        message: { text },
        locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } } }],
      })),
      properties: { check_kind: "framework", framework: "fastify", routes: routes.length },
    },
  ],
};
const out = resolve(args.out ?? "security-results/framework/framework.sarif");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(sarif, null, 2)}\n`);

const lines = [
  `Fastify の規約: ルート ${routes.length} 件（${routes.map((r) => `${r.method.toUpperCase()} ${r.path}`).join(", ")}）→ 違反 ${findings.length} 件`,
  ...findings.map(([id, uri, m]) => `[FAIL] ${id} ${uri}: ${m}`),
];
process.stdout.write(`${lines.join("\n")}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Fastify の規約\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`,
  );
process.exitCode = findings.length ? 1 : 0;
