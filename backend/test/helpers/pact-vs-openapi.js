// consumer contract（Pact ファイル）の期待を、契約の正本 openapi.yaml と突き合わせる（api-11 の (a)〜(d)）。
//   (a) 呼ぶ operation（メソッド + パス）が契約に宣言されている
//   (b) リクエスト本文が契約のリクエストスキーマに合う
//   (c) 期待する応答のステータスが、その operation に宣言されている
//   (d) 応答で頼る項目が、契約に存在し、必須（required）で、型が一致する。error.code は Error.code の列挙にある
// 問題の一覧（文字列）を返す。空なら契約と整合している。
import { conforms, findOperation, resolveRef } from "./contract.js";

const SCHEMA_REF = /^#\/components\/schemas\/(\w+)$/;

function jsonMediaOf(node) {
  return resolveRef(node)?.content?.["application/json"]?.schema;
}

/** 例の値の型（JSON Schema の type）。 */
function typeOfValue(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value === "object" ? "object" : typeof value;
}

function checkProperty(key, value, schema, path) {
  const property = schema.properties?.[key];
  if (!property) return [`${path}.${key}: 契約に無い項目に頼っている`];
  const optional = (schema.required ?? []).includes(key)
    ? []
    : [`${path}.${key}: 契約で必須でない項目に頼っている`];
  return [...optional, ...checkShape(value, property, `${path}.${key}`)];
}

function checkObject(example, schema, path) {
  return Object.entries(example).flatMap(([key, value]) => checkProperty(key, value, schema, path));
}

function checkScalar(example, schema, path) {
  if (schema.enum && !schema.enum.includes(example))
    return [`${path}: 契約の列挙に無い値 ${JSON.stringify(example)}`];
  return [];
}

/** consumer の例（本文）が使う項目だけを、契約のスキーマに突き合わせる。 */
export function checkShape(example, schemaNode, path) {
  const schema = resolveRef(schemaNode);
  const expected = schema.type === "integer" ? "number" : schema.type;
  const actual = typeOfValue(example);
  if (expected && expected !== actual)
    return [`${path}: 型が契約と違う（契約 ${expected} / 期待 ${actual}）`];
  if (actual === "object") return checkObject(example, schema, path);
  if (actual === "array") return example.length ? checkShape(example[0], schema.items, `${path}[]`) : [];
  return checkScalar(example, schema, path);
}

function requestSchemaName(operation) {
  const ref = jsonMediaOf(operation.requestBody)?.$ref ?? "";
  return SCHEMA_REF.exec(ref)?.[1];
}

function checkRequest(interaction, operation, label) {
  const body = interaction.request.body?.content;
  if (body === undefined) return operation.requestBody?.required ? [`${label}: 必須の本文が無い`] : [];
  const name = requestSchemaName(operation);
  if (!name) return [`${label}: 契約にリクエスト本文の定義が無いのに本文を送る`];
  return conforms(name, body) ? [] : [`${label}: リクエスト本文が契約の ${name} に合わない`];
}

function checkResponse(interaction, operation, label) {
  const status = String(interaction.response.status);
  const declared = operation.responses[status];
  if (!declared) return [`${label}: ステータス ${status} が契約に宣言されていない`];
  const body = interaction.response.body?.content;
  const schemaNode = jsonMediaOf(declared);
  if (body === undefined) return [];
  if (!schemaNode) return [`${label}: 契約に本文の定義が無い応答に、本文を期待している`];
  return checkShape(body, schemaNode, `${label} 応答`);
}

/** @param {{interactions: Array<object>}} pact */
export function checkPactAgainstOpenApi(pact) {
  return pact.interactions.flatMap((interaction) => {
    const { method, path } = interaction.request;
    const label = `「${interaction.description}」(${method} ${path})`;
    const found = findOperation(method, path);
    if (!found) return [`${label}: 契約に宣言されていない operation`];
    return [
      ...checkRequest(interaction, found.operation, label),
      ...checkResponse(interaction, found.operation, label),
    ];
  });
}
