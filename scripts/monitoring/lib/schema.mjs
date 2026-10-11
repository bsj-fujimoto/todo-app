// OpenAPI（backend/openapi.yaml）の components.schemas を使う最小の JSON Schema 検証。純関数。
// 対応: $ref（#/components/schemas/X）、type（object/array/string/boolean/number/integer）、required、properties、
//       additionalProperties: false、enum、minLength、items、format（uuid / date-time）。外形監視で契約の主要項目を確かめるのに足りる範囲。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TYPE_CHECKS = {
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === "string",
  boolean: (v) => typeof v === "boolean",
  number: (v) => typeof v === "number",
  integer: (v) => Number.isInteger(v),
};

function checkFormat(format, value) {
  if (format === "uuid") return UUID_RE.test(value);
  if (format === "date-time") return !Number.isNaN(Date.parse(value));
  return true;
}

function checkRequired(schema, value, path) {
  return (schema.required || []).filter((key) => !(key in value)).map((key) => `${path}.${key} が無い`);
}

function checkExtra(schema, value, path) {
  if (schema.additionalProperties !== false) return [];
  const props = schema.properties || {};
  return Object.keys(value)
    .filter((key) => !(key in props))
    .map((key) => `${path}.${key} は契約にないフィールド`);
}

function checkObject(schema, value, path, ctx) {
  const errors = [...checkRequired(schema, value, path), ...checkExtra(schema, value, path)];
  for (const [key, sub] of Object.entries(schema.properties || {})) {
    if (key in value) errors.push(...validate(sub, value[key], `${path}.${key}`, ctx));
  }
  return errors;
}

function checkScalar(schema, value, path) {
  const errors = [];
  if (schema.enum && !schema.enum.includes(value))
    errors.push(`${path} が列挙値外: ${JSON.stringify(value)}`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} が短い`);
    if (schema.format && !checkFormat(schema.format, value))
      errors.push(`${path} が ${schema.format} 形式でない`);
  }
  return errors;
}

export function resolveRef(ref, doc) {
  const name = ref.replace("#/components/schemas/", "");
  const target = doc.components.schemas[name];
  if (!target) throw new Error(`未知の schema: ${ref}`);
  return target;
}

export function validate(schema, value, path, ctx) {
  if (schema.$ref) return validate(resolveRef(schema.$ref, ctx.doc), value, path, ctx);
  if (schema.type && !TYPE_CHECKS[schema.type](value)) return [`${path} が ${schema.type} でない`];
  const errors = checkScalar(schema, value, path);
  if (schema.type === "object") errors.push(...checkObject(schema, value, path, ctx));
  if (schema.type === "array" && schema.items) {
    value
      .slice(0, 20)
      .forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`, ctx)));
  }
  return errors;
}

// 名前（Task / TaskList / Health / Error）で検証する。配列は先頭 20 件だけ見る（大量データでも軽く）
export function validateNamed(name, value, openapi) {
  return validate({ $ref: `#/components/schemas/${name}` }, value, "$", { doc: openapi });
}
