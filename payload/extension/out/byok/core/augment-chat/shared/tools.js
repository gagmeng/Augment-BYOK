"use strict";

const { normalizeString } = require("../../../infra/util");
const { asRecord, asArray, asString, pick } = require("../../augment-struct");

function normalizeToolDefinitions(raw) {
  const list = asArray(raw);
  const out = [];
  for (const it of list) {
    const r = asRecord(it);
    const name = normalizeString(pick(r, ["name"]));
    if (!name) continue;
    const description = asString(pick(r, ["description"])) || "";
    const input_schema = pick(r, ["input_schema", "inputSchema"]);
    const input_schema_json = asString(pick(r, ["input_schema_json", "inputSchemaJson"])) || "";
    const mcp_server_name = asString(pick(r, ["mcp_server_name", "mcpServerName"])) || "";
    const mcp_tool_name = asString(pick(r, ["mcp_tool_name", "mcpToolName"])) || "";
    out.push({ name, description, input_schema: input_schema && typeof input_schema === "object" ? input_schema : null, input_schema_json, mcp_server_name, mcp_tool_name });
  }
  return out;
}

function resolveToolSchema(def) {
  if (def && def.input_schema && typeof def.input_schema === "object" && !Array.isArray(def.input_schema)) return def.input_schema;
  const raw = normalizeString(def && def.input_schema_json);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return { type: "object", properties: {} };
}

// OpenAI Responses / tool transport schema 不兼容的 JSON Schema 关键字黑名单。
// 这些关键字在部分网关或上游实现下可能导致工具 schema 被拒绝或行为不一致，
// 因此在 provider 转换前统一做 transport sanitize。
// 参考: https://platform.openai.com/docs/guides/structured-outputs#supported-schemas
const OPENAI_STRICT_UNSUPPORTED_KEYWORDS = new Set([
  "propertyNames", "patternProperties", "unevaluatedProperties", "unevaluatedItems",
  "dependencies", "dependentRequired", "dependentSchemas",
  "if", "then", "else",
  "minProperties", "maxProperties",
  "contains", "minContains", "maxContains",
  "contentMediaType", "contentEncoding", "contentSchema",
  "$comment", "examples", "deprecated", "readOnly", "writeOnly",
  "$id", "$schema", "$anchor", "$vocabulary", "$dynamicAnchor", "$dynamicRef"
]);

function sanitizeJsonSchemaForTransport(schema, depth) {
  const d = Number.isFinite(Number(depth)) ? Number(depth) : 0;
  if (d > 50) return schema;
  if (Array.isArray(schema)) return schema.map((x) => sanitizeJsonSchemaForTransport(x, d + 1));
  if (!schema || typeof schema !== "object") return schema;

  const out = { ...schema };
  for (const k of OPENAI_STRICT_UNSUPPORTED_KEYWORDS) delete out[k];

  const t = out.type;
  const hasObjectType = t === "object" || (Array.isArray(t) && t.some((x) => normalizeString(x).toLowerCase() === "object"));
  const hasProps = out.properties && typeof out.properties === "object" && !Array.isArray(out.properties);
  if (hasObjectType || hasProps) {
    if (!hasObjectType) out.type = "object";
    const props = hasProps ? out.properties : {};
    const next = {};
    for (const k of Object.keys(props)) next[k] = sanitizeJsonSchemaForTransport(props[k], d + 1);
    out.properties = next;
    if (out.additionalProperties != null && out.additionalProperties !== false) out.additionalProperties = false;
  }

  if (out.items != null) out.items = sanitizeJsonSchemaForTransport(out.items, d + 1);
  if (out.prefixItems != null) out.prefixItems = sanitizeJsonSchemaForTransport(out.prefixItems, d + 1);
  if (Array.isArray(out.oneOf)) {
    out.anyOf = (out.anyOf || []).concat(out.oneOf);
    delete out.oneOf;
  }
  if (Array.isArray(out.allOf)) {
    if (out.allOf.length === 1 && out.allOf[0] && typeof out.allOf[0] === "object" && !Array.isArray(out.allOf[0])) {
      const merged = sanitizeJsonSchemaForTransport(out.allOf[0], d + 1);
      delete out.allOf;
      for (const [mk, mv] of Object.entries(merged)) {
        if (!(mk in out)) out[mk] = mv;
      }
    } else {
      out.anyOf = (out.anyOf || []).concat(out.allOf);
      delete out.allOf;
    }
  }
  if (Array.isArray(out.anyOf)) out.anyOf = out.anyOf.map((x) => sanitizeJsonSchemaForTransport(x, d + 1));
  if (out.not != null) out.not = sanitizeJsonSchemaForTransport(out.not, d + 1);

  if (out.$defs && typeof out.$defs === "object" && !Array.isArray(out.$defs)) {
    const defs = out.$defs;
    const next = {};
    for (const k of Object.keys(defs)) next[k] = sanitizeJsonSchemaForTransport(defs[k], d + 1);
    out.$defs = next;
  }
  if (out.definitions && typeof out.definitions === "object" && !Array.isArray(out.definitions)) {
    const defs = out.definitions;
    const next = {};
    for (const k of Object.keys(defs)) next[k] = sanitizeJsonSchemaForTransport(defs[k], d + 1);
    out.definitions = next;
  }

  return out;
}

function resolveToolSchemaForTransport(def) {
  return sanitizeJsonSchemaForTransport(resolveToolSchema(def), 0);
}

function convertOpenAiTools(toolDefs) {
  const defs = normalizeToolDefinitions(toolDefs);
  return defs.map((d) => ({ type: "function", function: { name: d.name, ...(normalizeString(d.description) ? { description: d.description } : {}), parameters: resolveToolSchemaForTransport(d) } }));
}

function convertAnthropicTools(toolDefs) {
  const defs = normalizeToolDefinitions(toolDefs);
  return defs.map((d) => ({ name: d.name, ...(normalizeString(d.description) ? { description: d.description } : {}), input_schema: resolveToolSchemaForTransport(d) }));
}

function convertGeminiTools(toolDefs) {
  const defs = normalizeToolDefinitions(toolDefs);
  const decls = defs.map((d) => ({ name: d.name, ...(normalizeString(d.description) ? { description: d.description } : {}), parameters: resolveToolSchemaForTransport(d) }));
  if (!decls.length) return [];
  return [{ functionDeclarations: decls }];
}

function convertOpenAiResponsesTools(toolDefs) {
  const defs = normalizeToolDefinitions(toolDefs);
  return defs.map((d) => ({
    type: "function",
    name: d.name,
    parameters: resolveToolSchemaForTransport(d),
    strict: false,
    ...(normalizeString(d.description) ? { description: d.description } : {})
  }));
}

function buildToolMetaByName(toolDefs) {
  const defs = normalizeToolDefinitions(toolDefs);
  const map = new Map();
  for (const d of defs) {
    const toolName = normalizeString(d.name);
    if (!toolName) continue;
    const mcpServerName = normalizeString(d.mcp_server_name);
    const mcpToolName = normalizeString(d.mcp_tool_name);
    if (!mcpServerName && !mcpToolName) continue;
    map.set(toolName, { mcpServerName: mcpServerName || undefined, mcpToolName: mcpToolName || undefined });
  }
  return map;
}

module.exports = {
  normalizeToolDefinitions,
  resolveToolSchema,
  sanitizeJsonSchemaForTransport,
  resolveToolSchemaForTransport,
  convertOpenAiTools,
  convertAnthropicTools,
  convertGeminiTools,
  convertOpenAiResponsesTools,
  buildToolMetaByName
};
