"use strict";

const { debug, audit } = require("../../../infra/log");
const { ensureConfigManager, state } = require("../../../config/state");
const { decideRoute } = require("../../../core/router");
const { deleteHistorySummaryCache } = require("../../../core/augment-history-summary/auto");
const { normalizeEndpoint, normalizeString, randomId } = require("../../../infra/util");
const { normalizeTimeoutMs, formatRouteForLog } = require("../common");

function safeDecodeURIComponent(v) {
  try {
    return decodeURIComponent(String(v || ""));
  } catch {
    return String(v || "");
  }
}

function extractConversationIdFromEndpoint(ep) {
  const endpoint = normalizeEndpoint(ep);
  if (!endpoint) return "";
  const lower = endpoint.toLowerCase();
  if (!lower.includes("conversation") && !lower.includes("thread")) return "";

  const m = endpoint.match(/\/(?:conversations?|threads?)\/([^/]+)/i);
  if (m && m[1]) return normalizeString(safeDecodeURIComponent(m[1]));

  return "";
}

async function maybeDeleteHistorySummaryCacheForEndpoint(ep, body) {
  const endpoint = normalizeEndpoint(ep);
  if (!endpoint) return false;
  const lower = endpoint.toLowerCase();
  if (!lower.includes("delete") && !lower.includes("remove") && !lower.includes("archive")) return false;
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  const conversationId =
    normalizeString(b?.conversation_id ?? b?.conversationId ?? b?.conversationID) || extractConversationIdFromEndpoint(endpoint);
  if (!conversationId) return false;
  try {
    const ok = await deleteHistorySummaryCache(conversationId);
    if (ok) debug(`historySummary cache deleted: conv=${conversationId} endpoint=${endpoint}`);
    return ok;
  } catch (err) {
    debug(`historySummary cache delete failed (ignored): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function resolveByokRouteContext({ endpoint, body, timeoutMs, logPrefix }) {
  const requestId = randomId();
  const ep = normalizeEndpoint(endpoint);
  if (!ep) return { requestId, ep: "", timeoutMs: 0, cfg: null, route: null, runtimeEnabled: false };

  await maybeDeleteHistorySummaryCacheForEndpoint(ep, body);

  const cfgMgr = ensureConfigManager();
  const cfg = cfgMgr.get();
  const t = normalizeTimeoutMs(timeoutMs);

  if (!state.runtimeEnabled) return { requestId, ep, timeoutMs: t, cfg, route: null, runtimeEnabled: false };

  const route = decideRoute({ cfg, endpoint: ep, body, runtimeEnabled: state.runtimeEnabled });
  audit(`[${String(logPrefix || "callApi")}] ${formatRouteForLog(route, { requestId })}`);
  return { requestId, ep, timeoutMs: t, cfg, route, runtimeEnabled: true };
}

module.exports = { resolveByokRouteContext };
