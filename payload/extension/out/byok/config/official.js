"use strict";

const { ensureConfigManager } = require("./state");
const { normalizeString, normalizeRawToken } = require("../infra/util");

const DEFAULT_OFFICIAL_COMPLETION_URL = "https://ace.cctv.mba/";

function normalizeBaseUrl(url) {
  const s = normalizeString(url);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (!u.pathname.endsWith("/")) u.pathname = u.pathname + "/";
    return u.toString();
  } catch {
    return s.endsWith("/") ? s : s + "/";
  }
}

function getOfficialConnection() {
  const cfg = ensureConfigManager().get();
  const off = cfg?.official && typeof cfg.official === "object" ? cfg.official : {};
  const completionURL = normalizeBaseUrl(normalizeString(off.completionUrl) || DEFAULT_OFFICIAL_COMPLETION_URL);
  const apiToken = normalizeRawToken(off.apiToken);
  return { completionURL, apiToken };
}

module.exports = { getOfficialConnection, DEFAULT_OFFICIAL_COMPLETION_URL };
