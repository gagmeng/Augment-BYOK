"use strict";

const { normalizeEndpoint, normalizeString } = require("../../infra/util");
const { isOfficialExecutionDelegationEndpoint, isOfficialDelegationEndpoint } = require("../../core/official-delegation");
const { normalizeRole, toText } = require("./text-assembly/prompt-utils");
const { tryFromEndpointFields } = require("./text-assembly/endpoint-fields");
const {
  isObject,
  normalizeDelegationSource,
  auditDelegationHit,
  auditDelegationMiss
} = require("./official-delegation-shared");

function tryFromMessages(rawBody) {
  const candidates = [rawBody?.messages, rawBody?.chat_messages, rawBody?.chatMessages];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;

    const systemParts = [];
    const messages = [];
    for (const item of candidate) {
      const r = isObject(item) ? item : {};
      const role = normalizeRole(r.role ?? r.author ?? r.type ?? r.sender);
      if (!role) continue;
      const content = toText(r.content ?? r.text ?? r.message);
      if (!normalizeString(content)) continue;

      if (role === "system") {
        systemParts.push(content);
      } else {
        messages.push({ role, content });
      }
    }

    if (messages.length > 0) {
      return {
        ok: true,
        system: systemParts.join("\n\n").trim(),
        messages,
        source: "upstream.callApiBody.messages"
      };
    }
  }

  return null;
}

function tryFromResponsesInput(rawBody) {
  const input = rawBody?.input;
  if (!Array.isArray(input) || input.length === 0) return null;

  const systemParts = [];
  const instructions = normalizeString(rawBody?.instructions);
  if (instructions) systemParts.push(instructions);

  const messages = [];
  for (const item of input) {
    const r = isObject(item) ? item : {};
    const type = normalizeString(r.type).toLowerCase();
    if (type && type !== "message") continue;

    const role = normalizeRole(r.role ?? r.author ?? r.sender);
    if (!role) continue;
    const content = toText(r.content ?? r.text ?? r.message);
    if (!normalizeString(content)) continue;

    if (role === "system") {
      systemParts.push(content);
    } else {
      messages.push({ role, content });
    }
  }

  if (messages.length > 0) {
    return {
      ok: true,
      system: systemParts.join("\n\n").trim(),
      messages,
      source: "upstream.callApiBody.input"
    };
  }

  return null;
}

function tryFromDeepSearch(rawBody) {
  if (!rawBody || typeof rawBody !== "object") return null;

  const MAX_NODES = 2000;
  const MAX_DEPTH = 6;
  const SKIP_KEYS = new Set([
    "blobs",
    "diff",
    "code_block",
    "target_file_content",
    "targetFileContent",
    "diagnostics",
    "recent_changes",
    "recentChanges",
    "edit_events",
    "editEvents"
  ]);

  const seen = new WeakSet();
  const stack = [{ v: rawBody, depth: 0 }];
  let nodes = 0;

  while (stack.length && nodes < MAX_NODES) {
    const { v, depth } = stack.pop();
    nodes += 1;
    if (!v || typeof v !== "object") continue;

    if (Array.isArray(v)) {
      if (depth >= MAX_DEPTH) continue;
      for (const item of v) stack.push({ v: item, depth: depth + 1 });
      continue;
    }

    if (seen.has(v)) continue;
    seen.add(v);

    const hit = tryFromMessages(v) || tryFromResponsesInput(v);
    if (hit) return hit;

    if (depth >= MAX_DEPTH) continue;
    for (const [k, child] of Object.entries(v)) {
      if (SKIP_KEYS.has(k)) continue;
      stack.push({ v: child, depth: depth + 1 });
    }
  }

  return null;
}

async function maybeBuildDelegatedTextPrompt({
  endpoint,
  body
} = {}) {
  const ep = normalizeEndpoint(endpoint);
  if (!isOfficialExecutionDelegationEndpoint(ep)) return { ok: false, reason: "unsupported_endpoint" };
  if (isOfficialDelegationEndpoint(ep)) return { ok: false, reason: "chat_endpoint_use_chat_delegation" };

  const rawBody = isObject(body) ? body : {};
  const delegated = tryFromMessages(rawBody) || tryFromResponsesInput(rawBody) || tryFromDeepSearch(rawBody) || tryFromEndpointFields(ep, rawBody);

  if (!delegated) {
    auditDelegationMiss(`official text assembler delegated miss: ep=${ep}`, "invalid_request_body");
    return { ok: false, reason: "invalid_request_body" };
  }

  const source = normalizeDelegationSource(delegated.source);
  auditDelegationHit(`official text assembler delegated: ep=${ep}`, source);
  return {
    ok: true,
    system: typeof delegated.system === "string" ? delegated.system : "",
    messages: Array.isArray(delegated.messages) ? delegated.messages : [],
    source
  };
}

module.exports = {
  maybeBuildDelegatedTextPrompt
};
