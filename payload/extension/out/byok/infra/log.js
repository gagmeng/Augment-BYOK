"use strict";

const PREFIX = "[Augment-BYOK]";
const DEBUG = process.env.AUGMENT_BYOK_DEBUG === "1";

const MAX_LOG_STRING_BYTES = 4000;
const MAX_LOG_DEPTH = 6;
const MAX_LOG_ARRAY = 40;

function truncateForLog(s, maxBytes) {
  const raw = typeof s === "string" ? s : String(s ?? "");
  const m = Number.isFinite(Number(maxBytes)) && Number(maxBytes) > 0 ? Number(maxBytes) : MAX_LOG_STRING_BYTES;
  if (raw.length <= m) return raw;
  return `${raw.slice(0, m)}…<truncated>`;
}

function redactText(v) {
  if (typeof v !== "string") return v;
  let s = v;
  s = s.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, "Bearer ***");
  s = s.replace(/([?&](?:key|api_key|api-key|access_token|refresh_token)=)[^&\s]+/gi, "$1***");
  s = s.replace(/\bace_[A-Za-z0-9]{16,}\b/g, "ace_***");
  s = s.replace(/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, "sk-ant-***");
  s = s.replace(/\bsk-proj-[A-Za-z0-9_-]{16,}\b/g, "sk-proj-***");
  s = s.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-***");
  return truncateForLog(s, MAX_LOG_STRING_BYTES);
}

function omitMeta(key, value) {
  if (typeof value === "string") return `[omitted ${key} len=${value.length}]`;
  if (Array.isArray(value)) return `[omitted ${key} len=${value.length}]`;
  if (value && typeof value === "object") return `[omitted ${key} keys=${Object.keys(value).length}]`;
  return `[omitted ${key}]`;
}

function shouldOmitKey(keyLower) {
  return (
    keyLower === "prefix" ||
    keyLower === "suffix" ||
    keyLower === "selected_code" ||
    keyLower === "selectedcode" ||
    keyLower === "blobs" ||
    keyLower === "chat_history" ||
    keyLower === "chathistory" ||
    keyLower === "nodes" ||
    keyLower === "request_nodes" ||
    keyLower === "requestnodes" ||
    keyLower === "response_nodes" ||
    keyLower === "responsenodes" ||
    keyLower === "structured_request_nodes" ||
    keyLower === "structuredrequestnodes" ||
    keyLower === "structured_output_nodes" ||
    keyLower === "structuredoutputnodes" ||
    keyLower === "rules" ||
    keyLower === "tool_definitions" ||
    keyLower === "tooldefinitions"
  );
}

function shouldRedactKey(keyLower) {
  const k = String(keyLower || "").trim().toLowerCase();
  const compact = k.replace(/[^a-z0-9]/g, "");
  if (k === "authorization") return true;
  if (k === "x-api-key") return true;
  if (k === "api-key") return true;
  if (k === "x-goog-api-key") return true;
  if (compact.includes("apikey")) return true;
  if (compact.includes("apitoken")) return true;
  if (k === "encrypted_data" || k === "encrypteddata") return true;
  if (k === "iv") return true;
  return false;
}

function redactAny(value, ctx) {
  const depth = ctx && typeof ctx === "object" ? Number(ctx.depth) : 0;
  const seen = ctx && typeof ctx === "object" && ctx.seen instanceof WeakSet ? ctx.seen : new WeakSet();
  if (typeof value === "string") return redactText(value);
  if (value == null || typeof value !== "object") return value;
  if (depth >= MAX_LOG_DEPTH) return "[omitted depth]";
  if (seen.has(value)) return "[omitted circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const out = [];
    const limit = Math.min(value.length, MAX_LOG_ARRAY);
    for (let i = 0; i < limit; i++) out.push(redactAny(value[i], { depth: depth + 1, seen }));
    if (value.length > limit) out.push(`[... ${value.length - limit} more]`);
    return out;
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const keyLower = String(k || "").trim().toLowerCase();
    if (shouldOmitKey(keyLower)) { out[k] = omitMeta(keyLower, v); continue; }
    if (shouldRedactKey(keyLower)) {
      if (keyLower === "encrypted_data" || keyLower === "encrypteddata") out[k] = `[redacted encrypted_data len=${typeof v === "string" ? v.length : 0}]`;
      else if (keyLower === "iv") out[k] = `[redacted iv len=${typeof v === "string" ? v.length : 0}]`;
      else out[k] = "[redacted]";
      continue;
    }
    out[k] = redactAny(v, { depth: depth + 1, seen });
  }
  return out;
}

function sanitizeArgs(args) {
  return args.map((a) => {
    if (typeof a === "string") return redactText(a);
    if (a instanceof Error) {
      const e = new Error(redactText(a.message));
      e.name = a.name;
      return e;
    }
    if (a && typeof a === "object") return redactAny(a, { depth: 0, seen: new WeakSet() });
    return a;
  });
}

function debug(...args) {
  if (!DEBUG) return;
  console.log(PREFIX, ...sanitizeArgs(args));
}

function audit(...args) {
  console.log(PREFIX, ...sanitizeArgs(args));
}

function info(...args) {
  console.log(PREFIX, ...sanitizeArgs(args));
}

function warn(...args) {
  console.warn(PREFIX, ...sanitizeArgs(args));
}

function error(...args) {
  console.error(PREFIX, ...sanitizeArgs(args));
}

module.exports = { debug, audit, info, warn, error, redactText };
