"use strict";

const { normalizeString } = require("../../infra/util");
const augmentChatShared = require("../../core/augment-chat/shared");
const { REQUEST_NODE_TEXT, REQUEST_NODE_TOOL_RESULT } = require("../../core/augment-protocol");

function makeTextRequestNode({ id, text }) {
  return { id: Number(id) || 0, type: REQUEST_NODE_TEXT, content: "", text_node: { content: String(text || "") } };
}

function countNonToolRequestNodes(req) {
  const nodes = [
    ...(Array.isArray(req?.nodes) ? req.nodes : []),
    ...(Array.isArray(req?.structured_request_nodes) ? req.structured_request_nodes : []),
    ...(Array.isArray(req?.request_nodes) ? req.request_nodes : [])
  ];
  let n = 0;
  for (const node of nodes) if (augmentChatShared.normalizeNodeType(node) !== REQUEST_NODE_TOOL_RESULT) n += 1;
  return n;
}

function maybeInjectUserExtraTextParts({ req, target, startId }) {
  if (!req || typeof req !== "object") return false;
  if (!Array.isArray(target)) return false;
  if (countNonToolRequestNodes(req) > 0) return false;
  let id = Number.isFinite(Number(startId)) ? Number(startId) : -30;
  for (const part of augmentChatShared.buildUserExtraTextParts(req, { hasNodes: false })) {
    const s = normalizeString(part);
    if (!s) continue;
    target.push(makeTextRequestNode({ id, text: s.trim() }));
    id -= 1;
  }
  return true;
}

function pickInjectionTargetArray(req) {
  if (Array.isArray(req?.request_nodes) && req.request_nodes.length) return req.request_nodes;
  if (Array.isArray(req?.structured_request_nodes) && req.structured_request_nodes.length) return req.structured_request_nodes;
  if (Array.isArray(req?.nodes) && req.nodes.length) return req.nodes;
  if (Array.isArray(req?.nodes)) return req.nodes;
  return null;
}

module.exports = { makeTextRequestNode, pickInjectionTargetArray, maybeInjectUserExtraTextParts };

