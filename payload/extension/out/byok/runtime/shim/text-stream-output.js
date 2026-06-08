"use strict";

const { normalizeString } = require("../../infra/util");
const { makeBackChatResult } = require("../../core/protocol");
const { providerLabel } = require("./common");

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

module.exports = {
  buildByokTextTraceLabel,
  wrapChatResultTextDeltas
};
