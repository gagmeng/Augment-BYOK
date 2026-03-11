"use strict";

const { normalizeString } = require("../../infra/util");
const { makeBackChatResult } = require("../../core/protocol");
const { providerLabel } = require("./common");

function coerceTextDelta(delta) {
  return typeof delta === "string" ? delta : String(delta ?? "");
}

function buildByokTextTraceLabel({ ep, requestId, route, delegatedSource, labelSuffix } = {}) {
  const suffix = normalizeString(labelSuffix) || "delta";
  const endpoint = normalizeString(ep) || "(unknown)";
  const rid = normalizeString(requestId);
  const model = normalizeString(route?.model) || "unknown";
  const delegate = normalizeString(delegatedSource);
  return `[callApiStream ${endpoint}] rid=${rid} ${suffix} provider=${providerLabel(route?.provider)} model=${model}${delegate ? ` delegate=${delegate}` : ""}`;
}

async function* wrapChatResultTextDeltas(deltas) {
  for await (const delta of deltas) yield makeBackChatResult(delta, { nodes: [] });
}

async function* wrapInstructionTextDeltas(deltas, { meta } = {}) {
  const m = meta && typeof meta === "object" ? meta : {};
  yield { text: "", ...m };
  for await (const delta of deltas) {
    const text = coerceTextDelta(delta);
    if (!text) continue;
    yield { text, replacement_text: text };
  }
}

module.exports = {
  coerceTextDelta,
  buildByokTextTraceLabel,
  wrapChatResultTextDeltas,
  wrapInstructionTextDeltas
};
