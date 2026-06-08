"use strict";

const { warn } = require("../../../infra/log");
const { withTiming } = require("../../../infra/trace");
const { normalizeString, normalizeRawToken, safeTransform } = require("../../../infra/util");
const { getOfficialConnection } = require("../../../config/official");
const { fetchOfficialGetModels } = require("../../official/get-models");
const { ensureModelRegistryFeatureFlags } = require("../../../core/model-registry");
const {
  makeBackCompletionResult,
  buildByokModelsFromConfig,
  makeBackGetModelsResult,
  makeModelInfo
} = require("../../../core/protocol");
const { byokCompleteText } = require("../byok-text");
const { byokChat } = require("../byok-chat");
const { resolveByokRouteContext } = require("../route");
const { resolveByokTextPromptContext } = require("../text-assembly");
const { providerLabel } = require("../common");
const { rememberUpstreamCallHost } = require("../../upstream/discovery");

async function handleGetModels({ cfg, ep, transform, abortSignal, timeoutMs, upstreamApiToken, upstreamCompletionURL, requestId }) {
  const byokModels = buildByokModelsFromConfig(cfg);
  const defaultModel = (byokModels.length ? byokModels[0] : "") || "unknown";

  try {
    const off = getOfficialConnection();
    const completionURL = normalizeString(upstreamCompletionURL) || off.completionURL;
    const apiToken = normalizeRawToken(upstreamApiToken) || off.apiToken;
    const upstream = await withTiming(`[callApi ${ep}] rid=${requestId} official/get-models`, async () =>
      await fetchOfficialGetModels({ completionURL, apiToken, timeoutMs: Math.min(12000, timeoutMs), abortSignal })
    );
    if (byokModels.length) {
      const base = upstream && typeof upstream === "object" ? upstream : {};
      const baseFlags =
        base.feature_flags && typeof base.feature_flags === "object" && !Array.isArray(base.feature_flags) ? base.feature_flags : {};
      const scrubbedFlags = { ...baseFlags };
      delete scrubbedFlags.additional_chat_models;
      delete scrubbedFlags.additionalChatModels;
      delete scrubbedFlags.model_registry;
      delete scrubbedFlags.modelRegistry;
      delete scrubbedFlags.model_info_registry;
      delete scrubbedFlags.modelInfoRegistry;

      const flags = ensureModelRegistryFeatureFlags(scrubbedFlags, { byokModelIds: byokModels, defaultModel, agentChatModel: defaultModel });
      const models = byokModels.map(makeModelInfo);

      return safeTransform(transform, { ...base, default_model: defaultModel, models, feature_flags: flags }, ep);
    }

    return safeTransform(transform, upstream, ep);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn("get-models fallback to local", { requestId, error: msg });
    const local = makeBackGetModelsResult({ defaultModel, models: byokModels.map(makeModelInfo) });
    return safeTransform(transform, local, ep);
  }
}

async function handleCompletion({ cfg, route, ep, body, transform, timeoutMs, abortSignal, requestId }) {
  const { system, messages, delegatedSource } = await resolveByokTextPromptContext({
    cfg,
    route,
    endpoint: ep,
    body
  });
  const label = `[callApi ${ep}] rid=${requestId} complete provider=${providerLabel(route.provider)} model=${normalizeString(route.model) || "unknown"}${delegatedSource ? ` delegate=${delegatedSource}` : ""}`;
  const text = await withTiming(label, async () =>
    await byokCompleteText({ provider: route.provider, model: route.model, system, messages, timeoutMs, abortSignal })
  );
  return safeTransform(transform, makeBackCompletionResult(text), ep);
}

async function handleChat({ cfg, route, ep, body, transform, timeoutMs, abortSignal, upstreamApiToken, upstreamCompletionURL, requestId }) {
  const out = await byokChat({
    cfg,
    provider: route.provider,
    model: route.model,
    requestedModel: route.requestedModel,
    body,
    timeoutMs,
    abortSignal,
    upstreamCompletionURL,
    upstreamApiToken,
    requestId
  });
  return safeTransform(transform, out, ep);
}

const CALL_API_HANDLERS = {
  "/get-models": handleGetModels,
  "/chat": handleChat,
  "/completion": handleCompletion,
  "/chat-input-completion": handleCompletion
};

const SUPPORTED_CALL_API_ENDPOINTS = Object.freeze(Object.keys(CALL_API_HANDLERS).sort());

async function maybeHandleCallApi({ endpoint, body, transform, timeoutMs, abortSignal, upstreamApiToken, upstreamCompletionURL, upstreamCallHost }) {
  rememberUpstreamCallHost(upstreamCallHost, { stream: false });
  const { requestId, ep, timeoutMs: t, cfg, route, runtimeEnabled } = await resolveByokRouteContext({
    endpoint,
    body,
    timeoutMs,
    logPrefix: "callApi"
  });
  if (!ep) return undefined;
  if (!runtimeEnabled) return undefined;
  if (route.mode === "official") return undefined;
  if (route.mode === "disabled") {
    try {
      return safeTransform(transform, {}, `disabled:${ep}`);
    } catch {
      return {};
    }
  }
  if (route.mode !== "byok") return undefined;

  const handler = CALL_API_HANDLERS[ep];
  if (!handler) return undefined;
  return await handler({ cfg, route, ep, body, transform, timeoutMs: t, abortSignal, upstreamApiToken, upstreamCompletionURL, requestId });
}

module.exports = { maybeHandleCallApi, SUPPORTED_CALL_API_ENDPOINTS };
