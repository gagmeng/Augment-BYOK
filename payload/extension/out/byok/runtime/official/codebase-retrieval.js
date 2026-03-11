"use strict";

const { debug, warn } = require("../../infra/log");
const { normalizeString, normalizeRawToken } = require("../../infra/util");
const augmentChatShared = require("../../core/augment-chat/shared");
const { normalizeOfficialBlobsDiff } = require("../../core/blob-utils");
const { getOfficialConnection } = require("../../config/official");
const { joinBaseUrl, safeFetch } = require("../../providers/http");
const { readHttpErrorDetail } = require("../../providers/request-util");
const { makeTextRequestNode, pickInjectionTargetArray, maybeInjectUserExtraTextParts } = require("./common");

const OFFICIAL_CODEBASE_RETRIEVAL_MAX_OUTPUT_LENGTH = 20000;
const OFFICIAL_CODEBASE_RETRIEVAL_TIMEOUT_MS = 12000;

async function fetchOfficialCodebaseRetrieval({ completionURL, apiToken, informationRequest, blobs, maxOutputLength, timeoutMs, abortSignal }) {
  const url = joinBaseUrl(normalizeString(completionURL), "agents/codebase-retrieval");
  if (!url) throw new Error("completionURL 无效（无法请求官方 agents/codebase-retrieval）");
  const headers = { "content-type": "application/json" };
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;
  const max_output_length = Number.isFinite(Number(maxOutputLength)) && Number(maxOutputLength) > 0 ? Math.floor(Number(maxOutputLength)) : 20000;
  const basePayload = {
    information_request: String(informationRequest || ""),
    blobs: normalizeOfficialBlobsDiff(blobs) || { checkpoint_id: null, added_blobs: [], deleted_blobs: [] },
    dialog: [],
    max_output_length
  };
  const payload = { ...basePayload, disable_codebase_retrieval: false, enable_commit_retrieval: false };

  const postOnce = async (p) => {
    const resp = await safeFetch(
      url,
      { method: "POST", headers, body: JSON.stringify(p) },
      { timeoutMs, abortSignal, label: "augment/agents/codebase-retrieval" }
    );
    if (resp.ok) {
      const json = await resp.json().catch(() => null);
      return { ok: true, json };
    }
    const text = String(await readHttpErrorDetail(resp, { maxChars: 300 }) || "").trim();
    return { ok: false, status: resp.status, text };
  };

  let result = await postOnce(payload);
  if (!result.ok && (result.status === 400 || result.status === 422)) {
    const retry = await postOnce(basePayload);
    if (retry.ok) result = retry;
  }
  if (!result.ok) throw new Error(`agents/codebase-retrieval ${result.status}: ${result.text}`.trim());

  const json = result.json;
  if (!json || typeof json !== "object") throw new Error("agents/codebase-retrieval 响应不是 JSON 对象");
  const formatted = normalizeString(json.formatted_retrieval ?? json.formattedRetrieval);
  return formatted;
}

function buildCodebaseRetrievalInformationRequest(req) {
  const parts = [];
  const main = normalizeString(req?.message);
  if (main) parts.push(main.trim());
  for (const part of augmentChatShared.buildUserExtraTextParts(req, { hasNodes: false })) {
    const s = normalizeString(part);
    if (s) parts.push(s.trim());
  }
  if (normalizeString(req?.path)) parts.push(`path: ${String(req.path).trim()}`);
  if (normalizeString(req?.lang)) parts.push(`lang: ${String(req.lang).trim()}`);
  return parts.join("\n\n").trim();
}

async function maybeInjectOfficialCodebaseRetrieval({ req, timeoutMs, abortSignal, upstreamCompletionURL, upstreamApiToken }) {
  if (!req || typeof req !== "object") return false;
  if (req.disable_retrieval === true) return false;

  const info = buildCodebaseRetrievalInformationRequest(req);
  if (!normalizeString(info)) return false;

  const off = getOfficialConnection();
  const completionURL = normalizeString(upstreamCompletionURL) || off.completionURL;
  const apiToken = normalizeRawToken(upstreamApiToken) || off.apiToken;
  if (!completionURL || !apiToken) {
    debug("officialRetrieval skipped: missing completionURL/apiToken");
    return false;
  }

  const hardTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 120000;
  const t = Math.max(2000, Math.min(OFFICIAL_CODEBASE_RETRIEVAL_TIMEOUT_MS, Math.floor(hardTimeout * 0.5)));

  const baseBlobs = normalizeOfficialBlobsDiff(req.blobs) || { checkpoint_id: null, added_blobs: [], deleted_blobs: [] };
  const userGuidedBlobs = Array.isArray(req.user_guided_blobs) ? req.user_guided_blobs : [];
  const userGuidedBlobNames = userGuidedBlobs.map((b) => normalizeString(String(b ?? ""))).filter(Boolean);

  const hasCheckpoint = Boolean(normalizeString(baseBlobs.checkpoint_id));
  const hasAdded = Array.isArray(baseBlobs.added_blobs) && baseBlobs.added_blobs.length > 0;
  const hasDeleted = Array.isArray(baseBlobs.deleted_blobs) && baseBlobs.deleted_blobs.length > 0;
  const hasUserGuided = userGuidedBlobNames.length > 0;
  if (!hasCheckpoint && !hasAdded && !hasDeleted && !hasUserGuided) return false;

  try {
    const added_blobs = [...new Set([...(Array.isArray(baseBlobs.added_blobs) ? baseBlobs.added_blobs : []), ...userGuidedBlobNames])].slice(0, 500);
    const formatted = await fetchOfficialCodebaseRetrieval({
      completionURL,
      apiToken,
      informationRequest: info,
      blobs: { ...baseBlobs, added_blobs },
      maxOutputLength: OFFICIAL_CODEBASE_RETRIEVAL_MAX_OUTPUT_LENGTH,
      timeoutMs: t,
      abortSignal
    });
    if (!normalizeString(formatted)) return false;

    const retrievalNode = makeTextRequestNode({ id: -20, text: formatted.trim() });
    const target = pickInjectionTargetArray(req);
    if (!target) return false;
    maybeInjectUserExtraTextParts({ req, target, startId: -30 });
    target.push(retrievalNode);
    debug(`officialRetrieval injected: chars=${formatted.length} target_len=${target.length}`);
    return true;
  } catch (err) {
    warn(`officialRetrieval failed (ignored): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

module.exports = { maybeInjectOfficialCodebaseRetrieval };

