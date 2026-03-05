"use strict";

const { warn } = require("../../../infra/log");
const { withTiming } = require("../../../infra/trace");
const { normalizeString, normalizeRawToken, safeTransform } = require("../../../infra/util");
const { getOfficialConnection } = require("../../../config/official");
const { fetchOfficialGetModels } = require("../../official/get-models");
const { ensureModelRegistryFeatureFlags } = require("../../../core/model-registry");
const {
  buildMessagesForEndpoint,
  makeBackTextResult,
  makeBackCompletionResult,
  makeBackNextEditLocationResult,
  buildByokModelsFromConfig,
  makeBackGetModelsResult,
  makeModelInfo
} = require("../../../core/protocol");
const { parseNextEditLocCandidatesFromText, mergeNextEditLocCandidates } = require("../../../core/next-edit/loc-utils");
const { pickPath, pickNumResults } = require("../../../core/next-edit/fields");
const { byokCompleteText } = require("../byok-text");
const { byokChat } = require("../byok-chat");
const { resolveByokRouteContext } = require("../route");
const { maybeAugmentBodyWithWorkspaceBlob, pickNextEditLocationCandidates } = require("../next-edit");
const { providerLabel } = require("../common");

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

async function completeTextForEndpoint({ cfg, route, ep, body, timeoutMs, abortSignal, requestId, kind }) {
  const { system, messages } = buildMessagesForEndpoint(ep, body, cfg);
  const suffix = normalizeString(kind) || "complete";
  const label = `[callApi ${ep}] rid=${requestId} ${suffix} provider=${providerLabel(route.provider)} model=${normalizeString(route.model) || "unknown"}`;
  return await withTiming(label, async () =>
    await byokCompleteText({ provider: route.provider, model: route.model, system, messages, timeoutMs, abortSignal })
  );
}

async function handleCompletion({ cfg, route, ep, body, transform, timeoutMs, abortSignal, requestId }) {
  const text = await completeTextForEndpoint({ cfg, route, ep, body, timeoutMs, abortSignal, requestId, kind: "complete" });
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

async function handleNextEditLoc({ cfg, route, ep, body, transform, timeoutMs, abortSignal, requestId }) {
  const b = body && typeof body === "object" ? body : {};
  const max = pickNumResults(b, { defaultValue: 1, max: 6 });

  const baseline = pickNextEditLocationCandidates(body);
  const fallbackPath = pickPath(b) || normalizeString(baseline?.[0]?.item?.path);
  let llmCandidates = [];

  try {
    const bodyForPrompt = await maybeAugmentBodyWithWorkspaceBlob(body, { pathHint: fallbackPath });
    const text = await completeTextForEndpoint({ cfg, route, ep, body: bodyForPrompt, timeoutMs, abortSignal, requestId, kind: "llm" });
    llmCandidates = parseNextEditLocCandidatesFromText(text, { fallbackPath, max, source: "byok:llm" });
  } catch (err) {
    warn("next_edit_loc llm fallback to diagnostics", { requestId, error: err instanceof Error ? err.message : String(err) });
  }

  if (!llmCandidates.length) return safeTransform(transform, makeBackNextEditLocationResult(baseline), ep);
  const merged = mergeNextEditLocCandidates({ baseline, llmCandidates, max });
  return safeTransform(transform, makeBackNextEditLocationResult(merged), ep);
}

const CALL_API_HANDLERS = {
  "/get-models": handleGetModels,
  "/chat": handleChat,
  "/completion": handleCompletion,
  "/chat-input-completion": handleCompletion,
  "/next_edit_loc": handleNextEditLoc
};

const SUPPORTED_CALL_API_ENDPOINTS = Object.freeze(Object.keys(CALL_API_HANDLERS).sort());

async function maybeHandleCallApi({ endpoint, body, transform, timeoutMs, abortSignal, upstreamApiToken, upstreamCompletionURL }) {
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

  try {
    const handler = CALL_API_HANDLERS[ep];
    if (!handler) return undefined;
    return await handler({ cfg, route, ep, body, transform, timeoutMs: t, abortSignal, upstreamApiToken, upstreamCompletionURL, requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn("callApi BYOK failed, fallback official", { requestId, endpoint: ep, error: msg });
    return undefined;
  }
}

module.exports = { maybeHandleCallApi, SUPPORTED_CALL_API_ENDPOINTS };
