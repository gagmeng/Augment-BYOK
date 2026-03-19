"use strict";

const { normalizeString } = require("../../infra/util");
const { buildToolMetaByName } = require("../augment-chat");
const { completeTextByProviderType, streamTextDeltasByProviderType } = require("../provider-text");
const { streamAugmentChatChunksByProviderType, convertToolDefinitionsByProviderType } = require("../provider-augment-chat");
const { collectChatStream } = require("./stream");

function validateOpenAiResponsesToolSchema(schema, issues, path, depth) {
  const d = Number.isFinite(Number(depth)) ? Number(depth) : 0;
  if (d > 50) return;
  if (!schema) return;
  if (Array.isArray(schema)) {
    for (let i = 0; i < schema.length; i++) validateOpenAiResponsesToolSchema(schema[i], issues, `${path}[${i}]`, d + 1);
    return;
  }
  if (typeof schema !== "object") return;

  const t = schema.type;
  const hasObjectType = t === "object" || (Array.isArray(t) && t.some((x) => normalizeString(x).toLowerCase() === "object"));
  const props = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? schema.properties : null;
  const hasProps = Boolean(props);

  if (hasObjectType || hasProps) {
    if (schema.additionalProperties != null && schema.additionalProperties !== false) {
      issues.push(`${path || "<root>"}: additionalProperties must be false when provided`);
    }
  }

  if (props) {
    for (const k of Object.keys(props)) validateOpenAiResponsesToolSchema(props[k], issues, `${path ? path + "." : ""}properties.${k}`, d + 1);
  }

  if (schema.items != null) validateOpenAiResponsesToolSchema(schema.items, issues, `${path ? path + "." : ""}items`, d + 1);
  if (schema.prefixItems != null) validateOpenAiResponsesToolSchema(schema.prefixItems, issues, `${path ? path + "." : ""}prefixItems`, d + 1);
  if (schema.not != null) validateOpenAiResponsesToolSchema(schema.not, issues, `${path ? path + "." : ""}not`, d + 1);
  if (Array.isArray(schema.anyOf)) validateOpenAiResponsesToolSchema(schema.anyOf, issues, `${path ? path + "." : ""}anyOf`, d + 1);
  if (Array.isArray(schema.oneOf)) validateOpenAiResponsesToolSchema(schema.oneOf, issues, `${path ? path + "." : ""}oneOf`, d + 1);
  if (Array.isArray(schema.allOf)) validateOpenAiResponsesToolSchema(schema.allOf, issues, `${path ? path + "." : ""}allOf`, d + 1);

  if (schema.$defs && typeof schema.$defs === "object" && !Array.isArray(schema.$defs)) {
    for (const k of Object.keys(schema.$defs)) validateOpenAiResponsesToolSchema(schema.$defs[k], issues, `${path ? path + "." : ""}$defs.${k}`, d + 1);
  }
  if (schema.definitions && typeof schema.definitions === "object" && !Array.isArray(schema.definitions)) {
    for (const k of Object.keys(schema.definitions)) validateOpenAiResponsesToolSchema(schema.definitions[k], issues, `${path ? path + "." : ""}definitions.${k}`, d + 1);
  }
}

function pickProviderModel(provider, fetchedModels) {
  const dm = normalizeString(provider?.defaultModel);
  if (dm) return dm;
  const ms = Array.isArray(provider?.models) ? provider.models : [];
  const firstLocal = ms.map((x) => normalizeString(x)).find(Boolean);
  if (firstLocal) return firstLocal;
  const firstFetched = Array.isArray(fetchedModels) ? fetchedModels.map((x) => normalizeString(x)).find(Boolean) : "";
  return firstFetched || "";
}

async function completeTextByProvider({ provider, model, system, messages, timeoutMs, abortSignal }) {
  const type = normalizeString(provider?.type);
  const baseUrl = normalizeString(provider?.baseUrl);
  const apiKey = normalizeString(provider?.apiKey);
  const extraHeaders = provider?.headers && typeof provider.headers === "object" && !Array.isArray(provider.headers) ? provider.headers : {};
  const requestDefaults = provider?.requestDefaults && typeof provider.requestDefaults === "object" && !Array.isArray(provider.requestDefaults) ? provider.requestDefaults : {};

  return await completeTextByProviderType({ type, baseUrl, apiKey, model, system, messages, timeoutMs, abortSignal, extraHeaders, requestDefaults });
}

async function streamTextByProvider({ provider, model, system, messages, timeoutMs, abortSignal }) {
  const type = normalizeString(provider?.type);
  const baseUrl = normalizeString(provider?.baseUrl);
  const apiKey = normalizeString(provider?.apiKey);
  const extraHeaders = provider?.headers && typeof provider.headers === "object" && !Array.isArray(provider.headers) ? provider.headers : {};
  const requestDefaults = provider?.requestDefaults && typeof provider.requestDefaults === "object" && !Array.isArray(provider.requestDefaults) ? provider.requestDefaults : {};

  let out = "";
  const deltas = streamTextDeltasByProviderType({ type, baseUrl, apiKey, model, system, messages, timeoutMs, abortSignal, extraHeaders, requestDefaults });
  for await (const d of deltas) {
    if (typeof d === "string") out += d;
  }
  return out;
}

const convertToolsByProviderType = convertToolDefinitionsByProviderType;

function validateConvertedToolsForProvider(providerType, convertedTools) {
  const t = normalizeString(providerType);
  const tools = Array.isArray(convertedTools) ? convertedTools : [];
  if (t !== "openai_responses") return { ok: true, issues: [] };

  const issues = [];
  for (const tool of tools) {
    const name = normalizeString(tool?.name) || normalizeString(tool?.function?.name);
    const params = tool?.parameters ?? tool?.function?.parameters;
    const toolIssues = [];
    validateOpenAiResponsesToolSchema(params, toolIssues, "", 0);
    if (toolIssues.length) {
      issues.push(`${name || "(unknown tool)"}: ${toolIssues[0]}`);
    }
    if (issues.length >= 30) break;
  }
  return { ok: issues.length === 0, issues };
}

async function chatStreamByProvider({ provider, model, req, timeoutMs, abortSignal }) {
  const type = normalizeString(provider?.type);
  const baseUrl = normalizeString(provider?.baseUrl);
  const apiKey = normalizeString(provider?.apiKey);
  const extraHeaders = provider?.headers && typeof provider.headers === "object" && !Array.isArray(provider.headers) ? provider.headers : {};
  const requestDefaults = provider?.requestDefaults && typeof provider.requestDefaults === "object" && !Array.isArray(provider.requestDefaults) ? provider.requestDefaults : {};
  const toolMetaByName = buildToolMetaByName(req.tool_definitions);

  const gen = streamAugmentChatChunksByProviderType({
    type,
    baseUrl,
    apiKey,
    model,
    req,
    timeoutMs,
    abortSignal,
    extraHeaders,
    requestDefaults,
    toolMetaByName,
    supportToolUseStart: true,
    traceLabel: ""
  });
  return await collectChatStream(gen);
}

module.exports = {
  pickProviderModel,
  completeTextByProvider,
  streamTextByProvider,
  convertToolsByProviderType,
  validateConvertedToolsForProvider,
  chatStreamByProvider
};
