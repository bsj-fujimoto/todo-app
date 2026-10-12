// backend/openapi.yaml（契約の正本）を読み込み、応答を Ajv（ajv + ajv-formats）で契約のスキーマに対して検証する。
// 実装側にスキーマを二重定義しない。契約とずれた応答・本文はここで落ちる。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const SPEC_URL = new URL("../../openapi.yaml", import.meta.url);
const ROOT_ID = "urn:todo-app:openapi";

export const spec = parse(readFileSync(SPEC_URL, "utf8"));

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ ...spec, $id: ROOT_ID });

const validators = new Map();

export function resolveRef(node) {
  if (!node || typeof node.$ref !== "string") return node;
  const pointer = node.$ref.replace(/^#\//, "").split("/");
  return resolveRef(pointer.reduce((current, key) => current[key], spec));
}

/** components.schemas.<name> を検証する関数。 */
export function schemaValidator(name) {
  if (!validators.has(name))
    validators.set(name, ajv.compile({ $ref: `${ROOT_ID}#/components/schemas/${name}` }));
  return validators.get(name);
}

/** 本文が契約のスキーマ <name> に合うか（true/false）。リクエスト本文の適合判定にも使う。 */
export function conforms(name, value) {
  return schemaValidator(name)(value);
}

function validateAgainst(schemaNode, body, label) {
  // 契約の応答スキーマはすべて components.schemas への $ref（それ以外の形が増えたらここで落ちる）
  const match = /^#\/components\/schemas\/(\w+)$/.exec(schemaNode.$ref ?? "");
  assert.ok(match, `${label}: 応答スキーマが components.schemas への $ref ではない`);
  const validate = schemaValidator(match[1]);
  assert.ok(
    validate(body),
    `${label}: 契約のスキーマに合わない: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body)}`,
  );
}

/** HTTP メソッドと path（実際の URL のパス部分）から、契約の operation を探す。無ければ null。 */
export function findOperation(method, pathname) {
  for (const [template, item] of Object.entries(spec.paths)) {
    const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    const operation = item[method.toLowerCase()];
    if (pattern.test(pathname) && operation) return { template, operation };
  }
  return null;
}

/** 契約に載っている [METHOD, path テンプレート] の一覧（"GET /api/v1/tasks" 形式）。 */
export function declaredRoutes() {
  const methods = ["get", "post", "put", "patch", "delete"];
  return Object.entries(spec.paths).flatMap(([template, item]) =>
    methods.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${template}`),
  );
}

/**
 * 応答が契約どおりか検証する（status が宣言されている・content-type・本文のスキーマ）。
 * @param {{status: number, headers: Headers, text: string, body: unknown}} response
 * @returns {boolean} 契約にない operation（未定義のルート）なら false（検証しなかった）
 */
export function assertContract(response, method, pathname) {
  const found = findOperation(method, pathname);
  if (!found) return false;
  const label = `${method} ${pathname} -> ${response.status}`;
  const declared = resolveRef(found.operation.responses[String(response.status)]);
  assert.ok(
    declared,
    `${label}: 契約に宣言されていない status（宣言: ${Object.keys(found.operation.responses).join(", ")}）`,
  );
  const media = Object.entries(declared.content ?? {});
  if (media.length === 0) {
    assert.equal(response.text, "", `${label}: 本文なしのはずが本文がある`);
    return true;
  }
  const contentType = response.headers.get("content-type") ?? "";
  const [mediaType, mediaSpec] = media.find(([type]) => contentType.startsWith(type)) ?? [];
  assert.ok(mediaType, `${label}: content-type が契約と違う: ${contentType}`);
  validateAgainst(mediaSpec.schema, response.body, label);
  return true;
}
