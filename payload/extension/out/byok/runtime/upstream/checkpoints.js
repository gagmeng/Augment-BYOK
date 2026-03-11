"use strict";

const { debug } = require("../../infra/log");
const { normalizeString } = require("../../infra/util");
const { truncateText } = require("../../infra/text");
const { asRecord, asArray, pick, normalizeNodeType } = require("../../core/augment-struct");
const { REQUEST_NODE_CHECKPOINT_REF, REQUEST_NODE_EDIT_EVENTS } = require("../../core/augment-protocol");
const { getByokUpstreamGlobals, createTimedCache, getCachedSingleton } = require("./discovery");

function isCheckpointManagerCandidate(v) {
  return v && typeof v === "object" && typeof v.getCheckpointByRequestId === "function" && typeof v.getAggregateCheckpoint === "function";
}

const CHECKPOINT_MANAGER_CACHE = createTimedCache(30_000);

function getCheckpointManagerFromUpstream() {
  const { upstream } = getByokUpstreamGlobals();
  const ext = upstream?.augmentExtension;
  return getCachedSingleton({
    cache: CHECKPOINT_MANAGER_CACHE,
    predicate: isCheckpointManagerCandidate,
    directCandidates: [upstream?.checkpointManager, upstream?.checkpoint_manager],
    deepSearch: [
      { root: ext, maxDepth: 7, maxNodes: 8000 },
      { root: upstream, maxDepth: 5, maxNodes: 6000 }
    ]
  });
}

function normalizeInt(v, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeNodeId(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(Math.abs(n)) % 2147483648;
}

function splitLines(s) {
  if (typeof s !== "string") return [];
  if (!s) return [""];
  return s.split(/\r?\n/);
}

function buildSingleEditFromTextDiff(originalCode, modifiedCode, { maxChars = 1200, maxLines = 200 } = {}) {
  const a = typeof originalCode === "string" ? originalCode : String(originalCode ?? "");
  const b = typeof modifiedCode === "string" ? modifiedCode : String(modifiedCode ?? "");
  if (a === b) return null;

  const al = splitLines(a);
  const bl = splitLines(b);
  let prefix = 0;
  while (prefix < al.length && prefix < bl.length && al[prefix] === bl[prefix]) prefix += 1;

  let suffix = 0;
  while (suffix < al.length - prefix && suffix < bl.length - prefix && al[al.length - 1 - suffix] === bl[bl.length - 1 - suffix]) suffix += 1;

  const beforeLines = al.slice(prefix, Math.max(prefix, al.length - suffix));
  const afterLines = bl.slice(prefix, Math.max(prefix, bl.length - suffix));

  const beforeText = truncateText(beforeLines.slice(0, maxLines).join("\n"), maxChars);
  const afterText = truncateText(afterLines.slice(0, maxLines).join("\n"), maxChars);
  const lineStart = prefix + 1;

  return { before_line_start: lineStart, before_text: beforeText, after_line_start: lineStart, after_text: afterText };
}

function extractAbsPathFromChangeDoc(changeDoc) {
  const cd = asRecord(changeDoc);
  const fp = asRecord(pick(cd, ["filePath", "file_path"]));
  return normalizeString(pick(fp, ["absPath", "abs_path"])) || normalizeString(pick(cd, ["path"])) || "";
}

function buildEditEventsNodeFromCheckpoint(nodeId, checkpoint, source) {
  const cp = asRecord(checkpoint);
  const files = asArray(cp.files);
  const editEvents = [];

  for (const f of files) {
    const fileRec = asRecord(f);
    const cd = asRecord(pick(fileRec, ["changeDocument", "change_document"]));
    const originalCode = pick(cd, ["originalCode", "original_code"]);
    const modifiedCode = pick(cd, ["modifiedCode", "modified_code"]);
    const e = buildSingleEditFromTextDiff(originalCode, modifiedCode, { maxChars: 1200, maxLines: 200 });
    if (!e) continue;

    const path = extractAbsPathFromChangeDoc(cd);
    if (!path) continue;

    editEvents.push({
      path,
      before_blob_name: undefined,
      after_blob_name: undefined,
      edits: [e]
    });
    if (editEvents.length >= 6) break;
  }

  if (!editEvents.length) return null;

  const src = normalizeInt(source, { min: 0, max: 1000000 });
  const edit_events_node = { edit_events: editEvents, ...(src != null ? { source: src } : {}) };
  return { id: normalizeNodeId(nodeId), type: REQUEST_NODE_EDIT_EVENTS, edit_events_node };
}

async function hydrateCheckpointRefNode(checkpointManager, node, { abortSignal } = {}) {
  if (!checkpointManager) return null;
  const n = asRecord(node);
  const ref = asRecord(pick(n, ["checkpoint_ref_node", "checkpointRefNode"]));

  const requestId = normalizeString(pick(ref, ["request_id", "requestId"]));
  const fromTs = normalizeInt(pick(ref, ["from_timestamp", "fromTimestamp"]), { min: 0 });
  const toTs = normalizeInt(pick(ref, ["to_timestamp", "toTimestamp"]), { min: 0 });
  const source = normalizeInt(pick(ref, ["source"]), { min: 0 });

  if (abortSignal && abortSignal.aborted) return null;

  let cp = null;
  try {
    if (requestId) cp = await checkpointManager.getCheckpointByRequestId(requestId);
  } catch {
    cp = null;
  }

  if (!cp) {
    try {
      if (typeof checkpointManager.getAggregateCheckpoint === "function" && (fromTs != null || toTs != null)) {
        cp = await checkpointManager.getAggregateCheckpoint({
          ...(fromTs != null ? { minTimestamp: fromTs } : {}),
          ...(toTs != null ? { maxTimestamp: toTs } : {})
        });
      }
    } catch {
      cp = null;
    }
  }

  const files = asArray(cp && typeof cp === "object" ? cp.files : null);
  if (!files.length) return null;
  return buildEditEventsNodeFromCheckpoint(pick(n, ["id"]), cp, source);
}

async function hydrateCheckpointNodesInArray(checkpointManager, nodes, { maxNodes, abortSignal } = {}) {
  const list = Array.isArray(nodes) ? nodes : null;
  if (!list || !list.length) return { changed: 0, tried: 0 };

  const cap = Number.isFinite(Number(maxNodes)) && Number(maxNodes) > 0 ? Math.floor(Number(maxNodes)) : 8;
  let tried = 0;
  let changed = 0;

  for (let i = 0; i < list.length; i++) {
    if (abortSignal && abortSignal.aborted) break;
    const n = list[i];
    const t = normalizeNodeType(n);
    if (t !== REQUEST_NODE_CHECKPOINT_REF) continue;
    if (tried >= cap) break;
    tried += 1;

    const rep = await hydrateCheckpointRefNode(checkpointManager, n, { abortSignal });
    if (rep) {
      list[i] = rep;
      changed += 1;
    }
  }
  return { changed, tried };
}

function hasHydratableCheckpointNodes(req) {
  const r = asRecord(req);
  const cur = [...asArray(r.nodes), ...asArray(r.structured_request_nodes), ...asArray(r.request_nodes)];
  for (const n of cur) if (normalizeNodeType(n) === REQUEST_NODE_CHECKPOINT_REF) return true;
  const history = asArray(r.chat_history);
  for (let i = Math.max(0, history.length - 6); i < history.length; i++) {
    const h = asRecord(history[i]);
    const nodes = [...asArray(h.request_nodes), ...asArray(h.structured_request_nodes), ...asArray(h.nodes)];
    for (const n of nodes) if (normalizeNodeType(n) === REQUEST_NODE_CHECKPOINT_REF) return true;
  }
  return false;
}

function exchangeHasEditEventsNode(exchange) {
  const ex = asRecord(exchange);
  const nodes = [...asArray(ex.request_nodes), ...asArray(ex.structured_request_nodes), ...asArray(ex.nodes)];
  return nodes.some(
    (n) => normalizeNodeType(n) === REQUEST_NODE_EDIT_EVENTS && asRecord(pick(n, ["edit_events_node", "editEventsNode"])).edit_events != null
  );
}

async function maybeInjectUserModifiedChangesIntoHistory(checkpointManager, req, { abortSignal } = {}) {
  if (!checkpointManager || typeof checkpointManager.getAllUserModifiedChanges !== "function") return { ok: true, injected: 0, reason: "unsupported" };
  const r = asRecord(req);
  const history = asArray(r.chat_history);
  if (!history.length) return { ok: true, injected: 0, reason: "no_history" };

  let changes = null;
  try {
    changes = await checkpointManager.getAllUserModifiedChanges();
  } catch {
    changes = null;
  }
  if (!changes) return { ok: true, injected: 0, reason: "no_changes" };

  const getChangeByRequestId = (requestId) => {
    const id = normalizeString(requestId);
    if (!id) return null;
    if (changes && typeof changes.get === "function") return changes.get(id) || null;
    if (changes && typeof changes === "object") return changes[id] || null;
    return null;
  };

  let injected = 0;
  const start = Math.max(0, history.length - 12);
  for (let i = start; i < history.length; i++) {
    if (abortSignal && abortSignal.aborted) break;
    const ex = asRecord(history[i]);
    if (!Array.isArray(ex.request_nodes)) continue;
    if (exchangeHasEditEventsNode(ex)) continue;

    const cp = getChangeByRequestId(pick(ex, ["request_id", "requestId", "requestID", "id"]));
    const files = asArray(cp && typeof cp === "object" ? cp.files : null);
    if (!files.length) continue;

    const node = buildEditEventsNodeFromCheckpoint(ex.request_nodes.length, cp, 1);
    if (!node) continue;
    ex.request_nodes.push(node);
    injected += 1;
  }

  return { ok: true, injected, reason: "ok" };
}

async function maybeHydrateCheckpointNodesFromUpstream(req, { timeoutMs, abortSignal } = {}) {
  const r = req && typeof req === "object" ? req : null;
  if (!r) return { ok: true, changed: 0, checkpointNotFound: false, reason: "no_req" };
  const hasCheckpointRefs = hasHydratableCheckpointNodes(r);
  const hasHistory = asArray(r.chat_history).length > 0;
  if (!hasCheckpointRefs && !hasHistory) return { ok: true, changed: 0, checkpointNotFound: false, reason: "none" };
  if (abortSignal && abortSignal.aborted) return { ok: false, changed: 0, checkpointNotFound: false, reason: "aborted" };

  const checkpointManager = getCheckpointManagerFromUpstream();
  if (!checkpointManager) return { ok: true, changed: 0, checkpointNotFound: hasCheckpointRefs, reason: "checkpointManager_missing" };

  const maxNodesPerArray = 10;
  let changed = 0;
  let injected = 0;
  let checkpointRefTried = 0;
  let checkpointRefHydrated = 0;

  if (hasCheckpointRefs) {
    const arrays = [r.request_nodes, r.structured_request_nodes, r.nodes];
    for (const arr of arrays) {
      const res = await hydrateCheckpointNodesInArray(checkpointManager, arr, { maxNodes: maxNodesPerArray, abortSignal });
      checkpointRefHydrated += Number(res.changed) || 0;
      checkpointRefTried += Number(res.tried) || 0;
    }

    const history = asArray(r.chat_history);
    for (let i = Math.max(0, history.length - 6); i < history.length; i++) {
      if (abortSignal && abortSignal.aborted) break;
      const h = asRecord(history[i]);
      for (const arr of [h.request_nodes, h.structured_request_nodes, h.nodes]) {
        const res = await hydrateCheckpointNodesInArray(checkpointManager, arr, { maxNodes: maxNodesPerArray, abortSignal });
        checkpointRefHydrated += Number(res.changed) || 0;
        checkpointRefTried += Number(res.tried) || 0;
      }
    }
  }

  const injectRes = await maybeInjectUserModifiedChangesIntoHistory(checkpointManager, r, { abortSignal });
  if (injectRes.injected) injected += Number(injectRes.injected) || 0;

  changed = checkpointRefHydrated + injected;
  const checkpointNotFound = hasCheckpointRefs && checkpointRefTried > checkpointRefHydrated;
  if (changed) {
    debug(
      `[upstream checkpoints] ref_hydrated=${checkpointRefHydrated} ref_tried=${checkpointRefTried} injected=${injected} timeoutMs=${Number(timeoutMs) || 0} not_found=${String(checkpointNotFound)}`
    );
  }
  return {
    ok: true,
    changed,
    checkpointNotFound,
    checkpointRefTried,
    checkpointRefHydrated,
    injected,
    reason: "ok"
  };
}

module.exports = { maybeHydrateCheckpointNodesFromUpstream };

