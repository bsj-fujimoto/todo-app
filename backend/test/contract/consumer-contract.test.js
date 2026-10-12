// consumer contract の provider 検証（docs/06-api-test.md の api-11）。
// frontend が記録した期待（frontend/contracts/frontend-backend.json。Pact）を、本物の SQLite を使う backend に再生して検証し、
// さらに期待を openapi.yaml（契約の正本）と突き合わせる。結果は test-results/consumer-contract.json に機械可読で残す。
// 実行: npm run contract:consumer -w backend（frontend 側の記録は npm run contract:consumer -w frontend）
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Verifier } from "@pact-foundation/pact";
import { createHarness } from "../helpers/harness.js";
import { checkPactAgainstOpenApi } from "../helpers/pact-vs-openapi.js";
import { providerStates } from "./provider-states.js";

process.env.PACT_DO_NOT_TRACK ??= "true"; // 利用統計を送らない

// 注意: Pact の provider 検証（Rust 製の HTTP クライアント）は、OS の CA 証明書（/etc/ssl/certs）が無い最小のイメージ
// （node:*-slim など）では "builder error" で全 interaction が失敗する（disableSslVerification でも避けられない）。
// ubuntu の GitHub-hosted runner・macOS・alpine（ca-certificates-bundle あり）では問題ない。slim で動かすときは ca-certificates を入れる。
const PACT_PATH = fileURLToPath(
  new URL("../../../frontend/contracts/frontend-backend.json", import.meta.url),
);
const RESULT_PATH = fileURLToPath(new URL("../../test-results/consumer-contract.json", import.meta.url));
const pactText = readFileSync(PACT_PATH, "utf8");
const pact = JSON.parse(pactText);

/**
 * Verifier の結果（成功時は戻り値、失敗時は例外の message。どちらも JSON 文字列）。
 * interaction ごとの結果と、不一致の説明（errors）を取り出す。JSON でなければ（Verifier が動かなかったとき）null。
 */
function parseOutput(text) {
  try {
    const parsed = typeof text === "string" ? JSON.parse(text) : text;
    return {
      results: Object.fromEntries(parsed.interactionResults.map((r) => [r.description, r.result])),
      errors: parsed.errors ?? [],
    };
  } catch {
    return null;
  }
}

/** 失敗した interaction の不一致の説明（例: expected 503 but was 500）。 */
function mismatchesOf(errors, description) {
  return errors
    .filter((e) => e.interaction?.endsWith(` - ${description}`))
    .flatMap((e) => (e.mismatch?.mismatches ?? []).map((m) => `${m.type}: ${m.mismatch}`));
}

function writeRecord(record) {
  mkdirSync(new URL("../../test-results/", import.meta.url), { recursive: true });
  writeFileSync(RESULT_PATH, `${JSON.stringify(record, null, 2)}\n`);
}

describe("consumer contract: frontend の期待を backend が満たす（Pact）", () => {
  const harness = createHarness();
  let verified = { results: {}, errors: [] };
  let failure = null; // Verifier が動かなかった・結果を読めなかったときの例外

  before(async () => {
    const { dbPath } = await harness.sandbox();
    const api = await harness.start({ dbPath, contract: false });
    try {
      const output = await new Verifier({
        provider: pact.provider.name,
        providerBaseUrl: api.baseUrl,
        pactUrls: [PACT_PATH],
        stateHandlers: providerStates(dbPath),
        logLevel: "warn",
      }).verifyProvider();
      verified = parseOutput(output) ?? verified;
    } catch (error) {
      // 不一致があると Verifier は例外を投げ、message に interaction ごとの結果（JSON）が入っている
      const parsed = parseOutput(error.message);
      if (parsed) verified = parsed;
      else failure = error;
    }
  });
  after(async () => {
    await harness.cleanup();
    const interactions = pact.interactions.map((i) => ({
      description: i.description,
      method: i.request.method,
      path: i.request.path,
      status: i.response.status,
      result: verified.results[i.description] === "OK" ? "passed" : "failed",
    }));
    writeRecord({
      schema_version: 1,
      consumer: pact.consumer.name,
      provider: pact.provider.name,
      tool: {
        name: "pact",
        version: pact.metadata["pact-js"].version,
        spec: pact.metadata.pactSpecification.version,
      },
      pact_file: "frontend/contracts/frontend-backend.json",
      pact_sha256: createHash("sha256").update(pactText).digest("hex"),
      interaction_count: interactions.length,
      result: !failure && interactions.every((i) => i.result === "passed") ? "passed" : "failed",
      interactions,
    });
  });

  it("[TC-037] 記録された期待（interaction）が 1 件以上ある", () => {
    assert.ok(pact.interactions.length >= 1);
    assert.equal(pact.consumer.name, "frontend");
    assert.equal(pact.provider.name, "backend");
  });

  // for ループの中で関数（it のコールバック）を作らない（ESLint no-loop-func）。forEach の各回が自分の interaction を持つ
  pact.interactions.forEach((interaction) => {
    it(`[TC-037] ${interaction.description}（${interaction.request.method} ${interaction.request.path} → ${interaction.response.status}）`, () => {
      if (failure) assert.fail(`provider 検証が動かなかった:\n${failure.message}`);
      const mismatches = mismatchesOf(verified.errors, interaction.description);
      assert.equal(verified.results[interaction.description], "OK", mismatches.join("\n"));
    });
  });

  it("[TC-037] 期待が openapi.yaml と整合している（operation・リクエスト本文・ステータス・使う項目の必須性と型・error.code の列挙）", () => {
    assert.deepEqual(checkPactAgainstOpenApi(pact), []);
  });
});
