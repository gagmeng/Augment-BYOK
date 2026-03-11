"use strict";

const { withTiming, traceAsyncGenerator } = require("../../../infra/trace");
const { normalizeString, safeTransform, emptyAsyncGenerator } = require("../../../infra/util");
const { makeEndpointErrorText, guardObjectStream } = require("../../../core/stream-guard");
const { makeBackChatResult, makeBackNextEditGenerationChunk } = require("../../../core/protocol");
const { pickPath, pickBlobNameHint } = require("../../../core/next-edit/fields");
const { buildNextEditStreamRuntimeContext } = require("../../../core/next-edit/stream-utils");
const { STOP_REASON_END_TURN, makeBackChatChunk } = require("../../../core/augment-protocol");
const { byokCompleteText, byokStreamText } = require("../byok-text");
const { byokChatStream } = require("../byok-chat-stream");
const { resolveByokRouteContext } = require("../route");
const { resolveByokTextPromptContext } = require("../text-assembly");
const {
  buildByokTextTraceLabel,
  wrapChatResultTextDeltas,
  wrapInstructionTextDeltas
} = require("../text-stream-output");
const { maybeAugmentBodyWithWorkspaceBlob, buildInstructionReplacementMeta } = require("../next-edit");
const { formatRouteForLog } = require("../common");
const { rememberUpstreamCallHost } = require("../../upstream/discovery");

function guardWithMeta({ ep, src, transform, makeErrorChunk, requestId, route }) {
  return guardObjectStream({
    ep,
    src,
    transform,
    makeErrorChunk,
    logMeta: {
      requestId,
      route: formatRouteForLog(route)
    }
  });
}

async function makeByokTextDeltas({ cfg, route, ep, body, timeoutMs, abortSignal, requestId, labelSuffix } = {}) {
  const { system, messages, delegatedSource } = await resolveByokTextPromptContext({
    cfg,
    route,
    endpoint: ep,
    body
  });
  const label = buildByokTextTraceLabel({ ep, requestId, route, delegatedSource, labelSuffix });
  return traceAsyncGenerator(label, byokStreamText({ provider: route.provider, model: route.model, system, messages, timeoutMs, abortSignal }));
}

async function handleChatStream({ cfg, route, ep, body, transform, timeoutMs, abortSignal, upstreamApiToken, upstreamCompletionURL, requestId }) {
  const src = byokChatStream({
    cfg,
    provider: route.provider,
    model: route.model,
    requestedModel: route.requestedModel,
    body,
    timeoutMs,
    abortSignal,
    upstreamApiToken,
    upstreamCompletionURL,
    requestId
  });
  return guardWithMeta({
    ep,
    src,
    transform,
    requestId,
    route,
    makeErrorChunk: (err) => makeBackChatChunk({ text: makeEndpointErrorText(ep, err), stop_reason: STOP_REASON_END_TURN })
  });
}

async function handleChatResultDeltaStream({ cfg, route, ep, body, transform, timeoutMs, abortSignal, requestId }) {
  const deltas = await makeByokTextDeltas({ cfg, route, ep, body, timeoutMs, abortSignal, requestId, labelSuffix: "delta" });
  const src = wrapChatResultTextDeltas(deltas);

  return guardWithMeta({
    ep,
    transform,
    src,
    requestId,
    route,
    makeErrorChunk: (err) => makeBackChatResult(makeEndpointErrorText(ep, err), { nodes: [] })
  });
}

async function handleInstructionLikeStream({ cfg, route, ep, body, transform, timeoutMs, abortSignal, requestId }) {
  const meta = await buildInstructionReplacementMeta(body);
  const deltas = await makeByokTextDeltas({ cfg, route, ep, body, timeoutMs, abortSignal, requestId, labelSuffix: "delta" });
  const src = wrapInstructionTextDeltas(deltas, { meta });

  return guardWithMeta({
    ep,
    transform,
    src,
    requestId,
    route,
    makeErrorChunk: (err) => ({ text: makeEndpointErrorText(ep, err), ...meta })
  });
}

async function handleNextEditStream({ cfg, route, ep, body, transform, timeoutMs, abortSignal, requestId }) {
  const b = body && typeof body === "object" ? body : {};
  const hasPrefix = typeof b.prefix === "string";
  const hasSuffix = typeof b.suffix === "string";
  const bodyForContext =
    hasPrefix && hasSuffix
      ? b
      : await maybeAugmentBodyWithWorkspaceBlob(body, { pathHint: pickPath(body), blobKey: pickBlobNameHint(body) });

  const { promptBody, path, blobName, selectionBegin, selectionEnd, existingCode } = buildNextEditStreamRuntimeContext(bodyForContext);
  const { system, messages, delegatedSource } = await resolveByokTextPromptContext({
    cfg,
    route,
    endpoint: ep,
    body: promptBody
  });
  const label = buildByokTextTraceLabel({ ep, requestId, route, delegatedSource, labelSuffix: "complete" });
  const suggestedCode = await withTiming(label, async () =>
    await byokCompleteText({ provider: route.provider, model: route.model, system, messages, timeoutMs, abortSignal })
  );

  const raw = makeBackNextEditGenerationChunk({
    path: path || blobName,
    blobName,
    charStart: selectionBegin,
    charEnd: selectionEnd,
    existingCode,
    suggestedCode
  });
  return (async function* () {
    yield safeTransform(transform, raw, ep);
  })();
}

const CALL_API_STREAM_HANDLERS = {
  "/chat-stream": handleChatStream,
  "/prompt-enhancer": handleChatResultDeltaStream,
  "/instruction-stream": handleInstructionLikeStream,
  "/smart-paste-stream": handleInstructionLikeStream,
  "/generate-commit-message-stream": handleChatResultDeltaStream,
  "/next-edit-stream": handleNextEditStream
};

const SUPPORTED_CALL_API_STREAM_ENDPOINTS = Object.freeze(Object.keys(CALL_API_STREAM_HANDLERS).sort());

async function maybeHandleCallApiStream({ endpoint, body, transform, timeoutMs, abortSignal, upstreamApiToken, upstreamCompletionURL, upstreamCallHost }) {
  rememberUpstreamCallHost(upstreamCallHost, { stream: true });
  const { requestId, ep, timeoutMs: t, cfg, route, runtimeEnabled } = await resolveByokRouteContext({
    endpoint,
    body,
    timeoutMs,
    logPrefix: "callApiStream"
  });
  if (!ep) return undefined;
  if (!runtimeEnabled) return undefined;
  if (route.mode === "official") return undefined;
  if (route.mode === "disabled") return emptyAsyncGenerator();
  if (route.mode !== "byok") return undefined;

  const handler = CALL_API_STREAM_HANDLERS[ep];
  if (!handler) return undefined;
  return await handler({ cfg, route, ep, body, transform, timeoutMs: t, abortSignal, upstreamApiToken, upstreamCompletionURL, requestId });
}

module.exports = { maybeHandleCallApiStream, SUPPORTED_CALL_API_STREAM_ENDPOINTS };
