"use strict";

const { normalizeEndpoint, normalizeString, parseByokModelId } = require("../infra/util");
const { defaultConfig } = require("../config/default-config");

const DEFAULT_ROUTING_RULES = (() => {
  try {
    const cfg = defaultConfig();
    const rules = cfg?.routing?.rules && typeof cfg.routing.rules === "object" && !Array.isArray(cfg.routing.rules) ? cfg.routing.rules : null;
    const out = Object.create(null);
    if (!rules) return out;
    for (const [k, v] of Object.entries(rules)) {
      const ep = normalizeEndpoint(k);
      if (!ep) continue;
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      out[ep] = v;
    }
    return out;
  } catch {
    return Object.create(null);
  }
})();

function pickRequestedModel(body) {
  if (!body || typeof body !== "object") return "";
  const v =
    body.model ??
    body.model_id ??
    body.modelId ??
    body.modelID ??
    body.model_name ??
    body.modelName ??
    body.provider_model_name ??
    body.providerModelName;
  return normalizeString(v);
}

function getRule(cfg, endpoint) {
  const rules = cfg?.routing?.rules && typeof cfg.routing.rules === "object" ? cfg.routing.rules : null;
  const r = rules && rules[endpoint] && typeof rules[endpoint] === "object" ? rules[endpoint] : null;
  if (r) return r;
  const d = DEFAULT_ROUTING_RULES[endpoint];
  return d && typeof d === "object" ? d : null;
}

function pickProvider(cfg, providerId) {
  const list = Array.isArray(cfg?.providers) ? cfg.providers : [];
  const id = normalizeString(providerId);
  if (!id) return list.length ? list[0] : null;
  const p = list.find((x) => x && x.id === id);
  return p || null;
}

function decideRoute({ cfg, endpoint, body, runtimeEnabled }) {
  const ep = normalizeEndpoint(endpoint);
  if (!ep) return { mode: "official", endpoint: ep, reason: "empty_endpoint" };
  if (!runtimeEnabled) return { mode: "official", endpoint: ep, reason: "rollback_disabled" };

  const rule = getRule(cfg, ep);
  const requestedModel = pickRequestedModel(body);
  let parsed = null;
  try {
    parsed = parseByokModelId(requestedModel, { strict: true });
  } catch {
    parsed = null;
  }
  const mode = normalizeString(rule?.mode) || "official";
  if (mode === "disabled") return { mode, endpoint: ep, reason: "rule" };
  if (mode === "official" && !parsed) return { mode, endpoint: ep, reason: "rule" };
  if (mode !== "byok" && !parsed) return { mode: "official", endpoint: ep, reason: "unknown_mode" };
  const providerId = normalizeString(parsed?.providerId) || normalizeString(rule?.providerId) || "";
  const provider = pickProvider(cfg, providerId);
  if (!provider) {
    return {
      mode: "official",
      endpoint: ep,
      reason: "provider_missing",
      providerId,
      requestedModel
    };
  }
  const parsedModel = parsed && normalizeString(parsed.providerId) === normalizeString(provider?.id) ? parsed.modelId : "";
  const model = normalizeString(parsedModel) || normalizeString(rule?.model) || normalizeString(provider?.defaultModel) || "";
  return {
    mode: "byok",
    endpoint: ep,
    reason: parsed && mode !== "byok" ? "model_override" : "byok",
    providerId,
    provider,
    model,
    requestedModel
  };
}

module.exports = { decideRoute };
