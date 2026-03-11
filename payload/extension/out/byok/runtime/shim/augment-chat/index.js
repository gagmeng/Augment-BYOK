"use strict";

const { audit, debug, warn } = require("../../../infra/log");
const { normalizeString, utf8ByteLen } = require("../../../infra/util");
const { captureAugmentToolDefinitions } = require("../../../config/state");
const { normalizeAugmentChatRequest } = require("../../../core/augment-chat");
const { shouldRequestThinking, stripThinkingAndReasoningFromRequestDefaults } = require("../../../core/thinking-control");
const { maybeSummarizeAndCompactAugmentChatRequest, deleteHistorySummaryCache } = require("../../../core/augment-history-summary/auto");
const { mergeChatResponseMeta } = require("../../../core/chat-response-meta");
const { maybeInjectOfficialCodebaseRetrieval } = require("../../official/codebase-retrieval");
const { maybeInjectOfficialContextCanvas } = require("../../official/context-canvas");
const { maybeInjectOfficialExternalSources } = require("../../official/external-sources");
const { maybeHydrateAssetNodesFromUpstream } = require("../../upstream/assets");
const { maybeHydrateCheckpointNodesFromUpstream } = require("../../upstream/checkpoints");
const { maybeBuildDelegatedAugmentChatRequest } = require("../../upstream/official-chat-delegation");
const { auditDelegationHit, auditDelegationFailure, normalizeDelegationSource } = require("../../upstream/official-delegation-shared");
const { deriveWorkspaceFileChunksFromRequest } = require("../../workspace/file-chunks");
const { providerLabel, providerRequestContext } = require("../common");
const { MAX_TOKENS_ALIAS_KEYS, normalizePositiveInt, pickPositiveIntFromRecord } = require("../../../providers/request-defaults-util");
const { inferContextWindowTokensFromModelName } = require("../../../core/token-budget/context-window");
const { approxTokenCountFromByteLen, estimateRequestExtraSizeBytes, estimateHistorySizeBytes } = require("../../../core/augment-history-summary/auto/estimate");

function hasConfiguredMaxTokens(requestDefaults) {
  const rd = requestDefaults && typeof requestDefaults === "object" && !Array.isArray(requestDefaults) ? requestDefaults : {};

  // 兼容：不同 provider 对 max tokens 字段支持不一致；这里以“是否存在正整数配置”为准。
  if (pickPositiveIntFromRecord(rd, MAX_TOKENS_ALIAS_KEYS) != null) return true;

  // Gemini 的输出上限在 generationConfig.maxOutputTokens（这里不基于 provider.type 分支，避免分支散落）。
  const gc = rd.generationConfig && typeof rd.generationConfig === "object" && !Array.isArray(rd.generationConfig) ? rd.generationConfig : null;
  if (gc && normalizePositiveInt(gc.maxOutputTokens) != null) return true;

  return false;
}

function estimateAugmentChatRequestTokens(req) {
  const r = req && typeof req === "object" && !Array.isArray(req) ? req : {};
  const history = Array.isArray(r.chat_history) ? r.chat_history : [];

  const msg = typeof r.message === "string" ? r.message : String(r.message ?? "");
  const byokSystem = typeof r.byok_system_prompt === "string" ? r.byok_system_prompt : String(r.byok_system_prompt ?? "");
  const agentMem = typeof r.agent_memories === "string" ? r.agent_memories : String(r.agent_memories ?? "");
  const userGuide = typeof r.user_guidelines === "string" ? r.user_guidelines : String(r.user_guidelines ?? "");
  const workspaceGuide = typeof r.workspace_guidelines === "string" ? r.workspace_guidelines : String(r.workspace_guidelines ?? "");

  const extraBytes = estimateRequestExtraSizeBytes(r);
  const historyBytes = estimateHistorySizeBytes(history);
  const totalBytes =
    utf8ByteLen(msg) +
    utf8ByteLen(byokSystem) +
    utf8ByteLen(agentMem) +
    utf8ByteLen(userGuide) +
    utf8ByteLen(workspaceGuide) +
    extraBytes +
    historyBytes;
  return approxTokenCountFromByteLen(totalBytes);
}

function inferAutoMaxOutputTokens({ model, req } = {}) {
  const DEFAULT_FALLBACK = 8192;
  const HARD_CAP = 65536;
  const SAFETY_MARGIN_TOKENS = 1024;
  const m = normalizeString(model);
  if (!m) return DEFAULT_FALLBACK;

  const cw = inferContextWindowTokensFromModelName(m);
  if (!Number.isFinite(Number(cw)) || Number(cw) <= 0) return DEFAULT_FALLBACK;

  const ctxWindow = Math.floor(Number(cw));
  const promptTokens = estimateAugmentChatRequestTokens(req);
  const remaining = ctxWindow - promptTokens - SAFETY_MARGIN_TOKENS;
  if (!Number.isFinite(Number(remaining)) || Number(remaining) <= 0) return null;

  const out = Math.min(HARD_CAP, Math.floor(Number(remaining)));
  return out >= 256 ? out : 256;
}

function maybeInjectAutoMaxOutputTokensIntoRequestDefaults(requestDefaults, { model, req } = {}) {
  const rd = requestDefaults && typeof requestDefaults === "object" && !Array.isArray(requestDefaults) ? requestDefaults : {};
  if (hasConfiguredMaxTokens(rd)) return rd;
  const inferred = normalizePositiveInt(inferAutoMaxOutputTokens({ model, req }));
  if (inferred == null) return rd;
  return { ...rd, max_output_tokens: inferred };
}

function captureAugmentChatToolDefinitions({ endpoint, req, provider, providerType, requestedModel, conversationId, requestId }) {
  const ep = normalizeString(endpoint);
  if (!ep) return false;
  const r = req && typeof req === "object" ? req : {};
  try {
    captureAugmentToolDefinitions(r.tool_definitions, {
      endpoint: ep,
      providerId: normalizeString(provider?.id),
      providerType: normalizeString(providerType),
      requestedModel: normalizeString(requestedModel),
      conversationId: normalizeString(conversationId),
      ...(requestId ? { requestId: normalizeString(requestId) } : {})
    });
    return true;
  } catch {
    return false;
  }
}

function summarizeAugmentChatRequest(req) {
  const r = req && typeof req === "object" ? req : {};
  const msg = normalizeString(r.message);
  const hasNodes = Array.isArray(r.nodes) && r.nodes.length;
  const hasHistory = Array.isArray(r.chat_history) && r.chat_history.length;
  const hasReqNodes =
    (Array.isArray(r.structured_request_nodes) && r.structured_request_nodes.length) ||
    (Array.isArray(r.request_nodes) && r.request_nodes.length);
  const toolDefs = Array.isArray(r.tool_definitions) ? r.tool_definitions.length : 0;
  return { msg, hasNodes, hasHistory, hasReqNodes, toolDefs };
}

function isAugmentChatRequestEmpty(summary) {
  const s = summary && typeof summary === "object" ? summary : {};
  return !normalizeString(s.msg) && !s.hasNodes && !s.hasHistory && !s.hasReqNodes;
}

function logAugmentChatStart({ kind, requestId, provider, providerType, model, requestedModel, conversationId, summary }) {
  const label = normalizeString(kind) === "chat-stream" ? "chat-stream" : "chat";
  const rid = normalizeString(requestId);
  const s = summary && typeof summary === "object" ? summary : {};
  const msgLen = normalizeString(s.msg).length;

  debug(
    `[${label}] start${rid ? ` rid=${rid}` : ""} provider=${providerLabel(provider)} type=${normalizeString(providerType) || "unknown"} model=${normalizeString(model) || "unknown"} requestedModel=${normalizeString(requestedModel) || "unknown"} conv=${normalizeString(conversationId) || "n/a"} tool_defs=${Number(s.toolDefs) || 0} msg_len=${msgLen} has_nodes=${String(Boolean(s.hasNodes))} has_history=${String(Boolean(s.hasHistory))} has_req_nodes=${String(Boolean(s.hasReqNodes))}`
  );
}

async function prepareAugmentChatRequestForByok({
  cfg,
  req,
  requestedModel,
  fallbackProvider,
  fallbackModel,
  timeoutMs,
  abortSignal,
  upstreamCompletionURL,
  upstreamApiToken,
  requestId
}) {
  const rid = normalizeString(requestId);
  const meta = { checkpointNotFound: false, workspaceFileChunks: [] };
  const convId = normalizeString(req?.conversation_id ?? req?.conversationId ?? req?.conversationID);
  const requestIdOverride = normalizeString(req?.request_id_override ?? req?.requestIdOverride);

  const runStep = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      warn(label, { requestId: rid, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };

  await runStep("upstream assets hydrate failed (ignored)", async () => await maybeHydrateAssetNodesFromUpstream(req, { timeoutMs, abortSignal }));

  // Editable History：当用户编辑历史对话并重新发送时，上游可能会复用 conversationId，但 chat_history 内容已“分叉/回退”。
  // 即使 boundary requestId 不变，rolling summary 也可能失效（造成上下文回退不一致）。
  // 兜底：检测到 request_id_override 时直接删除该对话的 summary cache。
  if (convId && requestIdOverride) {
    await runStep("historySummary cache invalidate after request_id_override failed (ignored)", async () => await deleteHistorySummaryCache(convId));
  }

  const checkpointRes = await runStep("upstream checkpoints hydrate failed (ignored)", async () => await maybeHydrateCheckpointNodesFromUpstream(req, { timeoutMs, abortSignal }));
  if (checkpointRes && typeof checkpointRes === "object" && checkpointRes.checkpointNotFound === true) meta.checkpointNotFound = true;

  // Editable History / 用户修改历史：上游可能通过 checkpointManager 注入 user-modified changes 到 chat_history。
  // 这会让 rolling summary 的缓存失效（即使 boundary requestId 没变，内容也可能变了）。
  // 兜底：一旦检测到 injected>0，直接按 conversationId 失效该对话的 History Summary cache。
  if (convId && checkpointRes && typeof checkpointRes === "object" && Number(checkpointRes.injected) > 0) {
    await runStep("historySummary cache invalidate after editable history failed (ignored)", async () => await deleteHistorySummaryCache(convId));
  }

  await runStep("historySummary failed (ignored)", async () =>
    await maybeSummarizeAndCompactAugmentChatRequest({
      cfg,
      req,
      requestedModel,
      fallbackProvider,
      fallbackModel,
      timeoutMs,
      abortSignal
    })
  );

  await runStep("official codebase retrieval inject failed (ignored)", async () =>
    await maybeInjectOfficialCodebaseRetrieval({ req, timeoutMs, abortSignal, upstreamCompletionURL, upstreamApiToken })
  );
  await runStep("official context canvas inject failed (ignored)", async () =>
    await maybeInjectOfficialContextCanvas({ req, timeoutMs, abortSignal, upstreamCompletionURL, upstreamApiToken })
  );
  await runStep("official external sources inject failed (ignored)", async () =>
    await maybeInjectOfficialExternalSources({ req, timeoutMs, abortSignal, upstreamCompletionURL, upstreamApiToken })
  );

  try {
    meta.workspaceFileChunks = deriveWorkspaceFileChunksFromRequest(req, { maxChunks: 80 });
  } catch {
    meta.workspaceFileChunks = [];
  }

  return meta;
}

function resolveSupportToolUseStart(req) {
  const r = req && typeof req === "object" ? req : {};
  const fdf = r.feature_detection_flags && typeof r.feature_detection_flags === "object" ? r.feature_detection_flags : {};
  return fdf.support_tool_use_start === true || fdf.supportToolUseStart === true;
}

function resolveSupportParallelToolUse(req) {
  const r = req && typeof req === "object" ? req : {};
  const fdf = r.feature_detection_flags && typeof r.feature_detection_flags === "object" ? r.feature_detection_flags : {};
  return fdf.support_parallel_tool_use === true || fdf.supportParallelToolUse === true;
}

async function buildByokAugmentChatContext({
  kind,
  endpoint,
  cfg,
  provider,
  model,
  requestedModel,
  body,
  timeoutMs,
  abortSignal,
  upstreamCompletionURL,
  upstreamApiToken,
  requestId
}) {
  const label = normalizeString(kind) === "chat-stream" ? "chat-stream" : "chat";
  const ep = normalizeString(endpoint) || (label === "chat-stream" ? "/chat-stream" : "/chat");

  const prc = providerRequestContext(provider);
  const { type, baseUrl, apiKey, extraHeaders } = prc;
  let requestDefaults = prc.requestDefaults;
  let req = normalizeAugmentChatRequest(body);
  const rid = normalizeString(requestId);
  let delegatedSource = "";
  let delegatedMeta = null;
  const delegated = await maybeBuildDelegatedAugmentChatRequest({
    endpoint: ep,
    body
  });
  if (!(delegated && delegated.ok && delegated.req && typeof delegated.req === "object")) {
    const message = auditDelegationFailure("official assembler delegation failed", delegated?.reason);
    throw new Error(message);
  }
  req = normalizeAugmentChatRequest(delegated.req);
  delegatedSource = normalizeDelegationSource(delegated.source);
  delegatedMeta = delegated.meta && typeof delegated.meta === "object" ? delegated.meta : null;
  auditDelegationHit(`[${label}] delegated official assembler hit:`, delegatedSource, { fallbackSource: "unknown" });

  const conversationId = normalizeString(req?.conversation_id ?? req?.conversationId ?? req?.conversationID);

  // 非用户对话轮次（例如工具回填后的 continuation）不需要上游“thinking/reasoning”，避免多次思考导致开销/中断。
  if (!shouldRequestThinking(req)) {
    requestDefaults = stripThinkingAndReasoningFromRequestDefaults(requestDefaults);
  }

  captureAugmentChatToolDefinitions({
    endpoint: ep,
    req,
    provider,
    providerType: type,
    requestedModel,
    conversationId,
    requestId: rid
  });

  const summary = summarizeAugmentChatRequest(req);
  logAugmentChatStart({ kind: label, requestId: rid, provider, providerType: type, model, requestedModel, conversationId, summary });

  const traceLabel = `[${label}] upstream${rid ? ` rid=${rid}` : ""} provider=${providerLabel(provider)} type=${type || "unknown"} model=${normalizeString(model) || "unknown"}${delegatedSource ? ` delegate=${delegatedSource}` : ""}`;

  if (isAugmentChatRequestEmpty(summary)) {
    const responseMeta = mergeChatResponseMeta();
    return {
      kind: label,
      ep,
      rid,
      conversationId,
      type,
      baseUrl,
      apiKey,
      extraHeaders,
      requestDefaults,
      req,
      summary,
      checkpointNotFound: responseMeta.checkpointNotFound,
      workspaceFileChunks: responseMeta.workspaceFileChunks,
      responseMeta,
      traceLabel,
      empty: true
    };
  }

  const prep = await prepareAugmentChatRequestForByok({
    cfg,
    req,
    requestedModel,
    fallbackProvider: provider,
    fallbackModel: model,
    timeoutMs,
    abortSignal,
    upstreamCompletionURL,
    upstreamApiToken,
    requestId: rid
  });
  const responseMeta = mergeChatResponseMeta(delegatedMeta, prep);
  const checkpointNotFound = responseMeta.checkpointNotFound;
  const workspaceFileChunks = responseMeta.workspaceFileChunks;

  // 自动推断输出上限：仅在用户未配置任何 max tokens 时注入，避免破坏用户意图。
  // 与固定默认值不同，这里会尝试基于 model 的上下文窗口（从名称推断）与 prompt 体积动态计算。
  const beforeDefaults = requestDefaults;
  requestDefaults = maybeInjectAutoMaxOutputTokensIntoRequestDefaults(requestDefaults, { model, req });
  if (requestDefaults !== beforeDefaults) {
    debug(
      `[${label}] injected auto max_output_tokens=${Number(requestDefaults.max_output_tokens) || 0} (provider=${providerLabel(provider)} type=${type || "unknown"} model=${normalizeString(model) || "unknown"})`
    );
  }

  return {
    kind: label,
    ep,
    rid,
    conversationId,
    type,
    baseUrl,
    apiKey,
    extraHeaders,
    requestDefaults,
    req,
    summary,
    checkpointNotFound,
    workspaceFileChunks,
    responseMeta,
    traceLabel,
    empty: false
  };
}

module.exports = {
  resolveSupportToolUseStart,
  resolveSupportParallelToolUse,
  buildByokAugmentChatContext
};
