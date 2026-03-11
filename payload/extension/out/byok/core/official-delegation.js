"use strict";

const { normalizeEndpoint } = require("../infra/util");

const OFFICIAL_DELEGATION_ENDPOINTS = Object.freeze([
  /* BEGIN GENERATED: OFFICIAL_CHAT_ENDPOINTS */
  "/chat",
  "/chat-stream"
  /* END GENERATED: OFFICIAL_CHAT_ENDPOINTS */
]);
const OFFICIAL_DELEGATION_ENDPOINT_SET = new Set(OFFICIAL_DELEGATION_ENDPOINTS);

const OFFICIAL_EXECUTION_DELEGATION_ENDPOINTS = Object.freeze([
  /* BEGIN GENERATED: OFFICIAL_EXECUTION_DELEGATION_ENDPOINTS */
  "/chat",
  "/completion",
  "/chat-input-completion",
  "/next_edit_loc",
  "/chat-stream",
  "/prompt-enhancer",
  "/instruction-stream",
  "/smart-paste-stream",
  "/next-edit-stream",
  "/generate-commit-message-stream"
  /* END GENERATED: OFFICIAL_EXECUTION_DELEGATION_ENDPOINTS */
]);
const OFFICIAL_EXECUTION_DELEGATION_ENDPOINT_SET = new Set(OFFICIAL_EXECUTION_DELEGATION_ENDPOINTS);

function isOfficialDelegationEndpoint(endpoint) {
  const ep = normalizeEndpoint(endpoint);
  return OFFICIAL_DELEGATION_ENDPOINT_SET.has(ep);
}

function isOfficialExecutionDelegationEndpoint(endpoint) {
  const ep = normalizeEndpoint(endpoint);
  return OFFICIAL_EXECUTION_DELEGATION_ENDPOINT_SET.has(ep);
}

module.exports = {
  OFFICIAL_DELEGATION_ENDPOINTS,
  OFFICIAL_EXECUTION_DELEGATION_ENDPOINTS,
  isOfficialDelegationEndpoint,
  isOfficialExecutionDelegationEndpoint
};
