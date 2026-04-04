"use strict";

const { debug } = require("../infra/log");
const { nowMs, formatMs } = require("../infra/trace");
const { normalizeString, normalizeStringList, requireString, normalizeRawToken } = require("../infra/util");
const { joinBaseUrl } = require("./http");
const { openAiAuthHeaders, anthropicAuthHeaders } = require("./headers");
const { fetchWithRetry, makeUpstreamHttpError } = require("./request-util");
const { formatKnownProviderTypes } = require("../core/provider-types");

function baseUrlForLog(baseUrl) {
  const b = normalizeString(baseUrl);
  if (!b) return "";
  try {
    const u = new URL(b);
    const p = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${p}`;
  } catch {
    return b.replace(/\?.*$/, "").replace(/#.*$/, "");
  }
}

function parseModelIds(json) {
  if (!json || typeof json !== "object") return [];

  const pickId = (m) => normalizeString(m?.id) || normalizeString(m?.name) || normalizeString(m?.model);

  const data = Array.isArray(json.data) ? json.data : null;
  if (data) return normalizeStringList(data.map(pickId), { maxItems: 5000 });

  const models = Array.isArray(json.models) ? json.models : null;
  if (models) return normalizeStringList(models.map((m) => (typeof m === "string" ? m : pickId(m))), { maxItems: 5000 });

  const list = Array.isArray(json.model_ids) ? json.model_ids : Array.isArray(json.modelIds) ? json.modelIds : null;
  if (list) return normalizeStringList(list, { maxItems: 5000 });

  return [];
}

async function fetchModelsWithFallback({ urls, headers, timeoutMs, abortSignal, label }) {
  const tried = [];
  for (const url of normalizeStringList(urls, { maxItems: 50 })) {
    tried.push(url);
    const resp = await fetchWithRetry(url, { method: "GET", headers }, { timeoutMs, abortSignal, label });
    if (!resp.ok) {
      if (resp.status === 404) continue;
      throw await makeUpstreamHttpError(resp, { label, maxChars: 300 });
    }
    const json = await resp.json().catch(() => null);
    const models = parseModelIds(json);
    if (models.length) return models;
    throw new Error(`${label} 响应未包含可解析的 models 列表`);
  }
  throw new Error(`${label} 失败（404 或无可用结果），tried=${tried.length}`);
}

async function fetchOpenAiCompatibleModels({ baseUrl, apiKey, extraHeaders, timeoutMs, abortSignal }) {
  const b = requireString(baseUrl, "OpenAI baseUrl");
  const key = normalizeRawToken(apiKey);
  const extra = extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {};
  if (!key && Object.keys(extra).length === 0) throw new Error("OpenAI apiKey 未配置（且 headers 为空）");
  const urls = [joinBaseUrl(b, "models")];
  if (!b.includes("/v1")) urls.push(joinBaseUrl(b, "v1/models"));

  return await fetchModelsWithFallback({
    urls,
    headers: openAiAuthHeaders(key, extraHeaders),
    timeoutMs,
    abortSignal,
    label: "OpenAI(models)"
  });
}

async function fetchAnthropicModels({ baseUrl, apiKey, extraHeaders, timeoutMs, abortSignal }) {
  const b = requireString(baseUrl, "Anthropic baseUrl");
  const key = normalizeRawToken(apiKey);
  const extra = extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {};
  if (!key && Object.keys(extra).length === 0) throw new Error("Anthropic apiKey 未配置（且 headers 为空）");
  const urls = [joinBaseUrl(b, "models")];
  if (!b.includes("/v1")) urls.push(joinBaseUrl(b, "v1/models"));

  return await fetchModelsWithFallback({
    urls,
    headers: anthropicAuthHeaders(key, extraHeaders, { forceBearer: true }),
    timeoutMs,
    abortSignal,
    label: "Anthropic(models)"
  });
}

async function fetchGeminiAiStudioModels({ baseUrl, apiKey, extraHeaders, timeoutMs, abortSignal }) {
  const b = requireString(baseUrl, "Gemini baseUrl");
  const key = normalizeRawToken(apiKey);
  const extra = extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {};
  if (!key && Object.keys(extra).length === 0) throw new Error("Gemini apiKey 未配置（且 headers 为空）");
  const urls = [joinBaseUrl(b, "models")];
  if (!b.includes("/v1beta")) urls.push(joinBaseUrl(b, "v1beta/models"));

  const withKey = urls
    .map((u) => {
      if (!u) return "";
      try {
        const url = new URL(u);
        if (key) url.searchParams.set("key", key);
        return url.toString();
      } catch {
        return u;
      }
    })
    .filter(Boolean);

  return await fetchModelsWithFallback({
    urls: withKey,
    headers: extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {},
    timeoutMs,
    abortSignal,
    label: "Gemini(models)"
  });
}

async function fetchProviderModels({ provider, timeoutMs, abortSignal }) {
  if (!provider || typeof provider !== "object") throw new Error("provider 无效");
  const type = normalizeString(provider.type);
  const baseUrl = normalizeString(provider.baseUrl);
  const apiKey = normalizeString(provider.apiKey);
  const extraHeaders = provider.headers && typeof provider.headers === "object" ? provider.headers : {};
  const providerId = normalizeString(provider.id);
  const label = `models type=${type || "?"}${providerId ? ` id=${providerId}` : ""}`;

  const staticModels = normalizeStringList(
    Array.isArray(provider.models) ? provider.models : typeof provider.models === "string" ? [provider.models] : [],
    { maxItems: 5000 }
  );

  const t = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 15000;
  const t0 = nowMs();
  try {
    let models = [];
    if (type === "openai_compatible" || type === "openai_responses") models = await fetchOpenAiCompatibleModels({ baseUrl, apiKey, extraHeaders, timeoutMs: t, abortSignal });
    else if (type === "anthropic") models = await fetchAnthropicModels({ baseUrl, apiKey, extraHeaders, timeoutMs: t, abortSignal });
    else if (type === "gemini_ai_studio") models = await fetchGeminiAiStudioModels({ baseUrl, apiKey, extraHeaders, timeoutMs: t, abortSignal });
    else throw new Error(`未知 provider.type: ${type}（支持：${formatKnownProviderTypes()}）`);

    debug(`[${label}] ok (${formatMs(nowMs() - t0)}) baseUrl=${baseUrlForLog(baseUrl)} models=${models.length}`);
    return models;
  } catch (err) {
    if (staticModels.length > 0) {
      debug(`[${label}] upstream /models unavailable, fallback to static models list (${staticModels.length}): ${err instanceof Error ? err.message : String(err)}`);
      return staticModels;
    }
    const msg = err instanceof Error ? err.message : String(err);
    debug(`[${label}] FAIL (${formatMs(nowMs() - t0)}) baseUrl=${baseUrlForLog(baseUrl)}: ${msg}`);
    throw err;
  }
}

module.exports = { fetchProviderModels };
