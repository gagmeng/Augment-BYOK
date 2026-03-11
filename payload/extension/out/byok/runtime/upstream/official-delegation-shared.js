"use strict";

const { audit } = require("../../infra/log");
const { normalizeString } = require("../../infra/util");

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function pickWorkspaceFileChunks(raw) {
  const candidates = [raw?.workspace_file_chunks, raw?.workspaceFileChunks];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function pickCheckpointNotFound(raw) {
  return raw?.checkpoint_not_found === true || raw?.checkpointNotFound === true;
}

function pickDelegationMeta(raw) {
  return {
    checkpointNotFound: pickCheckpointNotFound(raw),
    workspaceFileChunks: pickWorkspaceFileChunks(raw)
  };
}

function normalizeDelegationSource(source, { fallback = "upstream.callApiBody" } = {}) {
  return normalizeString(source) || normalizeString(fallback);
}

function normalizeDelegationReason(reason, { fallback = "delegate_failed" } = {}) {
  return normalizeString(reason) || normalizeString(fallback);
}

function auditDelegationHit(prefix, source, { fallbackSource = "upstream.callApiBody" } = {}) {
  audit(`${String(prefix || "").trim()} source=${normalizeDelegationSource(source, { fallback: fallbackSource })}`);
}

function auditDelegationMiss(prefix, reason, { fallbackReason = "delegate_failed" } = {}) {
  audit(`${String(prefix || "").trim()} reason=${normalizeDelegationReason(reason, { fallback: fallbackReason })}`);
}

function formatDelegationFailure(prefix, reason, { fallbackReason = "delegate_failed" } = {}) {
  return `${String(prefix || "").trim()}: ${normalizeDelegationReason(reason, { fallback: fallbackReason })}`;
}

function auditDelegationFailure(prefix, reason, opts) {
  const message = formatDelegationFailure(prefix, reason, opts);
  audit(message);
  return message;
}

module.exports = {
  isObject,
  pickDelegationMeta,
  normalizeDelegationSource,
  normalizeDelegationReason,
  auditDelegationHit,
  auditDelegationMiss,
  formatDelegationFailure,
  auditDelegationFailure
};
