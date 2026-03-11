"use strict";

const { buildToolMetaByName } = require("../../../core/augment-chat");
const { injectChatResponseMetaStream } = require("../../../core/chat-response-meta");
const { STOP_REASON_END_TURN, makeBackChatChunk } = require("../../../core/augment-protocol");
const { streamAugmentChatChunksByProviderType } = require("../../../core/provider-augment-chat");
const {
  buildByokAugmentChatContext,
  resolveSupportToolUseStart,
  resolveSupportParallelToolUse
} = require("../augment-chat");

async function* byokChatStream({ cfg, provider, model, requestedModel, body, timeoutMs, abortSignal, upstreamCompletionURL, upstreamApiToken, requestId }) {
  const ctx = await buildByokAugmentChatContext({
    kind: "chat-stream",
    endpoint: "/chat-stream",
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
  });
  if (ctx.empty) {
    yield makeBackChatChunk({ text: "", stop_reason: STOP_REASON_END_TURN, meta: ctx.responseMeta });
    return;
  }

  const toolMetaByName = buildToolMetaByName(ctx.req.tool_definitions);
  const supportToolUseStart = resolveSupportToolUseStart(ctx.req);
  const supportParallelToolUse = resolveSupportParallelToolUse(ctx.req);
  const src = streamAugmentChatChunksByProviderType({
    type: ctx.type,
    baseUrl: ctx.baseUrl,
    apiKey: ctx.apiKey,
    model,
    req: ctx.req,
    timeoutMs,
    abortSignal,
    extraHeaders: ctx.extraHeaders,
    requestDefaults: ctx.requestDefaults,
    toolMetaByName,
    supportToolUseStart,
    supportParallelToolUse,
    traceLabel: ctx.traceLabel,
    nodeIdStart: 0
  });

  yield* injectChatResponseMetaStream(src, ctx.responseMeta);
}

module.exports = { byokChatStream };
