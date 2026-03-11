"use strict";

const { debug } = require("../../infra/log");
const { normalizeString } = require("../../infra/util");
const { asRecord, asArray, pick, normalizeNodeType } = require("../../core/augment-struct");
const {
  REQUEST_NODE_TEXT,
  REQUEST_NODE_IMAGE,
  REQUEST_NODE_IMAGE_ID,
  REQUEST_NODE_FILE_ID,
  IMAGE_FORMAT_PNG
} = require("../../core/augment-protocol");
const { getByokUpstreamGlobals, createTimedCache, getCachedSingleton } = require("./discovery");

function isAssetManagerCandidate(v) {
  return v && typeof v === "object" && typeof v.loadAsset === "function";
}

const ASSET_MANAGER_CACHE = createTimedCache(30_000);

function getAssetManagerFromUpstream() {
  const { upstream } = getByokUpstreamGlobals();
  const ext = upstream?.augmentExtension;
  return getCachedSingleton({
    cache: ASSET_MANAGER_CACHE,
    predicate: isAssetManagerCandidate,
    directCandidates: [upstream?.assetManager, upstream?.asset_manager],
    deepSearch: [
      { root: ext, maxDepth: 7, maxNodes: 8000 },
      { root: upstream, maxDepth: 5, maxNodes: 6000 }
    ]
  });
}

function bytesToUint8Array(bytes) {
  if (!bytes) return null;
  if (bytes instanceof Uint8Array) return bytes;
  if (Buffer.isBuffer(bytes)) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer);
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return null;
}

function bytesToUtf8(bytes) {
  const arr = bytesToUint8Array(bytes);
  if (!arr || !arr.length) return "";
  try {
    return Buffer.from(arr).toString("utf8");
  } catch {
    return "";
  }
}

function extractBase64PayloadFromDataUrl(raw) {
  const s = normalizeString(raw);
  if (!s) return "";
  if (!s.startsWith("data:")) return "";
  const parts = s.split(";base64,");
  if (!parts || parts.length < 2) return "";
  return normalizeString(parts.slice(1).join(";base64,"));
}

function bytesToBase64(bytes) {
  const arr = bytesToUint8Array(bytes);
  if (!arr || !arr.length) return "";
  const asText = bytesToUtf8(arr);
  const fromUrl = extractBase64PayloadFromDataUrl(asText);
  if (fromUrl) return fromUrl;
  try {
    return Buffer.from(arr).toString("base64");
  } catch {
    return "";
  }
}

function buildAttachmentText({ fileName, fileId, contentText, truncated }) {
  const name = normalizeString(fileName) || normalizeString(fileId) || "(unknown)";
  if (!normalizeString(contentText)) return `[Attachment: ${name}]`;
  const suffix = truncated ? "\n\n[Content truncated due to length...]" : "";
  return `[Attachment: ${name}]\n\nContent:\n${String(contentText)}${suffix}`.trim();
}

async function hydrateFileIdNode(assetManager, node, { maxChars }) {
  const n = asRecord(node);
  const fidNode = asRecord(pick(n, ["file_id_node", "fileIdNode"]));
  const fileId = normalizeString(pick(fidNode, ["file_id", "fileId"]));
  const fileName = normalizeString(pick(fidNode, ["file_name", "fileName"]));
  if (!fileId) return null;

  let bytes;
  try {
    bytes = await assetManager.loadAsset(fileId);
  } catch {
    bytes = null;
  }
  const arr = bytesToUint8Array(bytes);
  if (!arr || !arr.length) {
    return {
      type: REQUEST_NODE_TEXT,
      id: Number(n.id) || 0,
      content: "",
      text_node: { content: buildAttachmentText({ fileName, fileId, contentText: "", truncated: false }) }
    };
  }

  const max = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Math.floor(Number(maxChars)) : 20000;
  let txt = bytesToUtf8(arr);
  if (!txt) {
    return {
      type: REQUEST_NODE_TEXT,
      id: Number(n.id) || 0,
      content: "",
      text_node: { content: buildAttachmentText({ fileName, fileId, contentText: "", truncated: false }) }
    };
  }

  let truncated = false;
  if (txt.length > max) {
    txt = txt.slice(0, max);
    truncated = true;
  }
  return {
    type: REQUEST_NODE_TEXT,
    id: Number(n.id) || 0,
    content: "",
    text_node: { content: buildAttachmentText({ fileName, fileId, contentText: txt, truncated }) }
  };
}

async function hydrateImageIdNode(assetManager, node) {
  const n = asRecord(node);
  const imgIdNode = asRecord(pick(n, ["image_id_node", "imageIdNode"]));
  const imageId = normalizeString(pick(imgIdNode, ["image_id", "imageId"]));
  if (!imageId) return null;

  let bytes;
  try {
    bytes = await assetManager.loadAsset(imageId);
  } catch {
    bytes = null;
  }
  const data = bytesToBase64(bytes);
  if (!data) return null;

  const fmtRaw = Number(pick(imgIdNode, ["format"]));
  const format = Number.isFinite(fmtRaw) && fmtRaw >= 0 ? Math.floor(fmtRaw) : IMAGE_FORMAT_PNG;
  return { type: REQUEST_NODE_IMAGE, id: Number(n.id) || 0, content: "", image_node: { image_data: data, format } };
}

async function hydrateRequestNodesArray(assetManager, nodes, { maxNodes, maxCharsPerFile } = {}) {
  const list = Array.isArray(nodes) ? nodes : null;
  if (!list || !list.length) return { changed: 0, tried: 0 };

  const cap = Number.isFinite(Number(maxNodes)) && Number(maxNodes) > 0 ? Math.floor(Number(maxNodes)) : 8;
  let tried = 0;
  let changed = 0;

  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    const t = normalizeNodeType(n);
    if (t !== REQUEST_NODE_FILE_ID && t !== REQUEST_NODE_IMAGE_ID) continue;
    if (tried >= cap) break;
    tried += 1;

    if (t === REQUEST_NODE_FILE_ID) {
      const rep = await hydrateFileIdNode(assetManager, n, { maxChars: maxCharsPerFile });
      if (rep) {
        list[i] = rep;
        changed += 1;
      }
      continue;
    }

    if (t === REQUEST_NODE_IMAGE_ID) {
      const rep = await hydrateImageIdNode(assetManager, n);
      if (rep) {
        list[i] = rep;
        changed += 1;
      }
    }
  }

  return { changed, tried };
}

function hasHydratableAssetNodes(req) {
  const r = asRecord(req);
  const cur = [...asArray(r.nodes), ...asArray(r.structured_request_nodes), ...asArray(r.request_nodes)];
  for (const n of cur) {
    const t = normalizeNodeType(n);
    if (t === REQUEST_NODE_FILE_ID || t === REQUEST_NODE_IMAGE_ID) return true;
  }
  const history = asArray(r.chat_history);
  for (let i = Math.max(0, history.length - 6); i < history.length; i++) {
    const h = asRecord(history[i]);
    const nodes = [...asArray(h.request_nodes), ...asArray(h.structured_request_nodes), ...asArray(h.nodes)];
    for (const n of nodes) {
      const t = normalizeNodeType(n);
      if (t === REQUEST_NODE_FILE_ID || t === REQUEST_NODE_IMAGE_ID) return true;
    }
  }
  return false;
}

async function maybeHydrateAssetNodesFromUpstream(req, { timeoutMs, abortSignal } = {}) {
  const r = req && typeof req === "object" ? req : null;
  if (!r) return { ok: true, changed: 0, reason: "no_req" };
  if (!hasHydratableAssetNodes(r)) return { ok: true, changed: 0, reason: "none" };
  if (abortSignal && abortSignal.aborted) return { ok: false, changed: 0, reason: "aborted" };

  const assetManager = getAssetManagerFromUpstream();
  if (!assetManager) return { ok: true, changed: 0, reason: "assetManager_missing" };

  const maxCharsPerFile = 20000;
  const maxNodesPerArray = 10;
  let changed = 0;
  let tried = 0;

  const arrays = [r.request_nodes, r.structured_request_nodes, r.nodes];
  for (const arr of arrays) {
    const res = await hydrateRequestNodesArray(assetManager, arr, { maxNodes: maxNodesPerArray, maxCharsPerFile });
    changed += Number(res.changed) || 0;
    tried += Number(res.tried) || 0;
  }

  const history = asArray(r.chat_history);
  for (let i = Math.max(0, history.length - 6); i < history.length; i++) {
    if (abortSignal && abortSignal.aborted) break;
    const h = asRecord(history[i]);
    for (const arr of [h.request_nodes, h.structured_request_nodes, h.nodes]) {
      const res = await hydrateRequestNodesArray(assetManager, arr, { maxNodes: maxNodesPerArray, maxCharsPerFile });
      changed += Number(res.changed) || 0;
      tried += Number(res.tried) || 0;
    }
  }

  if (changed) debug(`[upstream assets] hydrated=${changed} tried=${tried} timeoutMs=${Number(timeoutMs) || 0}`);
  return { ok: true, changed, reason: "ok" };
}

module.exports = { maybeHydrateAssetNodesFromUpstream };

