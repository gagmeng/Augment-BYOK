"use strict";

const { debug, warn } = require("../../infra/log");
const { normalizeString, normalizeRawToken } = require("../../infra/util");
const { truncateTextForPrompt: truncateText } = require("../../infra/text");
const { getOfficialConnection } = require("../../config/official");
const { joinBaseUrl, safeFetch } = require("../../providers/http");
const { readHttpErrorDetail } = require("../../providers/request-util");
const { makeTextRequestNode, pickInjectionTargetArray, maybeInjectUserExtraTextParts } = require("./common");

const OFFICIAL_CONTEXT_CANVAS_TIMEOUT_MS = 4000;
const CONTEXT_CANVAS_CACHE_TTL_MS = 5 * 60 * 1000;
const CONTEXT_CANVAS_CACHE = new Map();

async function fetchOfficialContextCanvasList({ completionURL, apiToken, pageSize, pageToken, timeoutMs, abortSignal }) {
  const url = joinBaseUrl(normalizeString(completionURL), "context-canvas/list");
  if (!url) throw new Error("completionURL 无效（无法请求官方 context-canvas/list）");
  const headers = { "content-type": "application/json" };
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;
  const page_size = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0 ? Math.floor(Number(pageSize)) : 100;
  const payload = { page_size, page_token: String(pageToken || "") };
  const resp = await safeFetch(
    url,
    { method: "POST", headers, body: JSON.stringify(payload) },
    { timeoutMs, abortSignal, label: "augment/context-canvas/list" }
  );
  if (!resp.ok) throw new Error(`context-canvas/list ${resp.status}: ${await readHttpErrorDetail(resp, { maxChars: 300 })}`.trim());
  return await resp.json().catch(() => null);
}

function normalizeOfficialContextCanvasListResponse(raw) {
  const r = raw && typeof raw === "object" ? raw : null;
  const list = [];
  if (Array.isArray(raw)) list.push(...raw);
  else if (r) {
    const canvases = Array.isArray(r.canvases) ? r.canvases : [];
    list.push(...canvases);
  }

  const out = [];
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const canvas = it;
    const id = normalizeString(canvas.canvas_id ?? canvas.canvasId ?? canvas.canvasID ?? canvas.id ?? "");
    const name = normalizeString(canvas.name ?? canvas.title ?? "");
    const description = normalizeString(canvas.description ?? canvas.summary ?? "");
    if (!id && !name && !description) continue;
    out.push({ id, name, description });
  }

  const nextPageToken =
    r && typeof r === "object"
      ? normalizeString(r.next_page_token ?? r.nextPageToken ?? r.next_pageToken ?? r.page_token ?? r.pageToken ?? "")
      : "";
  return { canvases: out, nextPageToken };
}

function formatContextCanvasForPrompt(canvas, { canvasId } = {}) {
  const c = canvas && typeof canvas === "object" ? canvas : null;
  if (!c) return "";
  const id = normalizeString(canvasId ?? c.id);
  const name = truncateText(normalizeString(c.name), 200);
  const description = truncateText(normalizeString(c.description), 4000);
  const lines = ["[CONTEXT_CANVAS]"];
  if (id) lines.push(`canvas_id=${id}`);
  if (name) lines.push(`name=${name}`);
  if (description) lines.push(`description=${description}`);
  if (lines.length === 1) return "";
  lines.push("[/CONTEXT_CANVAS]");
  return lines.join("\n").trim();
}

function cacheKeyForCanvas(completionURL) {
  const key = normalizeString(completionURL);
  return key ? key : "";
}

function getCanvasCacheEntry(completionURL) {
  const key = cacheKeyForCanvas(completionURL);
  if (!key) return null;
  const e = CONTEXT_CANVAS_CACHE.get(key);
  if (!e) return null;
  if (Number(e.expiresAtMs || 0) <= Date.now()) {
    CONTEXT_CANVAS_CACHE.delete(key);
    return null;
  }
  return e;
}

function ensureCanvasCacheEntry(completionURL) {
  const key = cacheKeyForCanvas(completionURL);
  if (!key) return null;
  const existing = getCanvasCacheEntry(key);
  if (existing) return existing;
  const created = { expiresAtMs: Date.now() + CONTEXT_CANVAS_CACHE_TTL_MS, byId: new Map() };
  CONTEXT_CANVAS_CACHE.set(key, created);
  return created;
}

function upsertCanvasCache(completionURL, canvases) {
  const entry = ensureCanvasCacheEntry(completionURL);
  if (!entry) return;
  for (const c of Array.isArray(canvases) ? canvases : []) {
    if (!c || typeof c !== "object") continue;
    const id = normalizeString(c.id);
    if (!id) continue;
    entry.byId.set(id, c);
  }
  entry.expiresAtMs = Date.now() + CONTEXT_CANVAS_CACHE_TTL_MS;
}

function getCanvasFromCache(completionURL, canvasId) {
  const entry = getCanvasCacheEntry(completionURL);
  if (!entry || !entry.byId) return null;
  const id = normalizeString(canvasId);
  if (!id) return null;
  return entry.byId.get(id) || null;
}

async function maybeInjectOfficialContextCanvas({ req, timeoutMs, abortSignal, upstreamCompletionURL, upstreamApiToken }) {
  if (!req || typeof req !== "object") return false;
  if (req.disable_retrieval === true) return false;

  const canvasId = normalizeString(req.canvas_id);
  if (!canvasId) return false;

  const off = getOfficialConnection();
  const completionURL = normalizeString(upstreamCompletionURL) || off.completionURL;
  const apiToken = normalizeRawToken(upstreamApiToken) || off.apiToken;
  if (!completionURL || !apiToken) {
    debug("officialContextCanvas skipped: missing completionURL/apiToken");
    return false;
  }

  try {
    let canvas = getCanvasFromCache(completionURL, canvasId);
    if (!canvas) {
      const hardTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 120000;
      const t = Math.max(800, Math.min(OFFICIAL_CONTEXT_CANVAS_TIMEOUT_MS, Math.floor(hardTimeout * 0.15)));
      const deadline = Date.now() + t;
      let pageToken = "";
      let pages = 0;
      while (pages < 3 && Date.now() < deadline - 200) {
        const remaining = Math.max(300, deadline - Date.now());
        const raw = await fetchOfficialContextCanvasList({
          completionURL,
          apiToken,
          pageSize: 100,
          pageToken,
          timeoutMs: remaining,
          abortSignal
        });
        const { canvases, nextPageToken } = normalizeOfficialContextCanvasListResponse(raw);
        if (canvases.length) upsertCanvasCache(completionURL, canvases);
        canvas = canvases.find((c) => c && typeof c === "object" && normalizeString(c.id) === canvasId) || getCanvasFromCache(completionURL, canvasId);
        if (canvas) break;
        const next = normalizeString(nextPageToken);
        if (!next) break;
        pageToken = next;
        pages += 1;
      }
    }
    if (!canvas) return false;

    const text = formatContextCanvasForPrompt(canvas, { canvasId });
    if (!normalizeString(text)) return false;

    const target = pickInjectionTargetArray(req);
    if (!target) return false;
    maybeInjectUserExtraTextParts({ req, target, startId: -30 });

    const node = makeTextRequestNode({ id: -22, text });
    const idx = target.findIndex((n) => Number(n?.id) === -20);
    if (idx >= 0) target.splice(idx, 0, node);
    else target.push(node);
    debug(`officialContextCanvas injected: chars=${text.length} target_len=${target.length}`);
    return true;
  } catch (err) {
    warn(`officialContextCanvas failed (ignored): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

module.exports = { maybeInjectOfficialContextCanvas };

