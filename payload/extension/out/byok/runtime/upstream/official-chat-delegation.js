"use strict";

const { normalizeEndpoint, normalizeString } = require("../../infra/util");
const { normalizeAugmentChatRequest } = require("../../core/augment-chat");
const { isOfficialDelegationEndpoint } = require("../../core/official-delegation");
const {
  isObject,
  pickDelegationMeta,
  auditDelegationHit,
  auditDelegationMiss
} = require("./official-delegation-shared");

function looksLikeAugmentChatRequest(value) {
  if (!isObject(value)) return false;
  if (typeof value.message === "string" && normalizeString(value.message)) return true;
  if (Array.isArray(value.nodes) && value.nodes.length) return true;
  if (Array.isArray(value.request_nodes) && value.request_nodes.length) return true;
  if (Array.isArray(value.structured_request_nodes) && value.structured_request_nodes.length) return true;
  if (Array.isArray(value.chat_history) && value.chat_history.length) return true;
  if (Array.isArray(value.tool_definitions) && value.tool_definitions.length) return true;
  if (normalizeString(value.canvas_id)) return true;
  if (Array.isArray(value.external_source_ids) && value.external_source_ids.length) return true;
  return false;
}

function getOfficialChatDelegationApiFromUpstream() {
  return null;
}

function resetOfficialChatDelegationApiCacheForTest() {}

async function maybeBuildDelegatedAugmentChatRequest({
  endpoint,
  body
} = {}) {
  const ep = normalizeEndpoint(endpoint);
  if (!isOfficialDelegationEndpoint(ep)) return { ok: false, reason: "unsupported_endpoint" };

  const rawBody = isObject(body) ? body : {};
  const req = normalizeAugmentChatRequest(rawBody);
  if (!looksLikeAugmentChatRequest(req)) {
    auditDelegationMiss(`official assembler delegated miss: ep=${ep}`, "invalid_request_body");
    return { ok: false, reason: "invalid_request_body" };
  }

  auditDelegationHit(`official assembler delegated: ep=${ep}`, "upstream.callApiBody");
  return {
    ok: true,
    req,
    source: "upstream.callApiBody",
    meta: pickDelegationMeta(rawBody)
  };
}

module.exports = {
  getOfficialChatDelegationApiFromUpstream,
  maybeBuildDelegatedAugmentChatRequest,
  __resetOfficialChatDelegationApiCacheForTest: resetOfficialChatDelegationApiCacheForTest
};
