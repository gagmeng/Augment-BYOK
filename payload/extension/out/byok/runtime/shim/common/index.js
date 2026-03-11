"use strict";

const { DEFAULT_UPSTREAM_TIMEOUT_MS } = require("../../../infra/constants");
const { normalizeString, normalizeRawToken } = require("../../../infra/util");

function normalizeTimeoutMs(timeoutMs) {
  const t = Number(timeoutMs);
  return Number.isFinite(t) && t > 0 ? t : DEFAULT_UPSTREAM_TIMEOUT_MS;
}

function resolveProviderApiKey(provider, label) {
  if (!provider || typeof provider !== "object") throw new Error(`${label} provider 无效`);
  return normalizeRawToken(provider.apiKey);
}

function providerLabel(provider) {
  const id = normalizeString(provider?.id);
  const type = normalizeString(provider?.type);
  return `Provider(${id || type || "unknown"})`;
}

function formatRouteForLog(route, opts) {
  const r = route && typeof route === "object" ? route : {};
  const requestId = normalizeString(opts?.requestId);
  const endpoint = normalizeString(r.endpoint);
  const mode = normalizeString(r.mode) || "unknown";
  const reason = normalizeString(r.reason);
  const providerId = normalizeString(r.provider?.id) || normalizeString(r.providerId);
  const providerType = normalizeString(r.provider?.type);
  const model = normalizeString(r.model);
  const requestedModel = normalizeString(r.requestedModel);

  const parts = [];
  if (requestId) parts.push(`rid=${requestId}`);
  if (endpoint) parts.push(`ep=${endpoint}`);
  parts.push(`mode=${mode}`);
  if (reason) parts.push(`reason=${reason}`);
  if (providerId || providerType) parts.push(`provider=${providerId || providerType}`);
  if (model) parts.push(`model=${model}`);
  if (requestedModel) parts.push(`requestedModel=${requestedModel}`);
  return parts.join(" ");
}

function providerRequestContext(provider) {
  if (!provider || typeof provider !== "object") throw new Error("BYOK provider 未选择");
  const type = normalizeString(provider.type);
  const baseUrl = normalizeString(provider.baseUrl);
  const apiKey = resolveProviderApiKey(provider, providerLabel(provider));
  const extraHeaders = provider.headers && typeof provider.headers === "object" ? provider.headers : {};
  const requestDefaultsRaw = provider.requestDefaults && typeof provider.requestDefaults === "object" ? provider.requestDefaults : {};

  const requestDefaults =
    requestDefaultsRaw && typeof requestDefaultsRaw === "object" && !Array.isArray(requestDefaultsRaw) ? requestDefaultsRaw : {};
  if (!apiKey && Object.keys(extraHeaders).length === 0) throw new Error(`${providerLabel(provider)} 未配置 api_key（且 headers 为空）`);
  return { type, baseUrl, apiKey, extraHeaders, requestDefaults };
}

module.exports = {
  normalizeTimeoutMs,
  providerLabel,
  formatRouteForLog,
  providerRequestContext
};
