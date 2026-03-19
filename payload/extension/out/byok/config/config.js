"use strict";

const { debug, warn } = require("../infra/log");
const { normalizeString } = require("../infra/util");
const { defaultConfig } = require("./default-config");
const { normalizeConfig } = require("./normalize-config");
const { syncByokAuthState } = require("../runtime/auth-session");

const CONFIG_KEY = "augment-byok.config.v1";

class ConfigManager {
  constructor() {
    this.current = defaultConfig();
    this.lastGood = this.current;
    this.lastError = null;
    this._ctx = null;
  }

  attachContext(ctx) {
    this._ctx = ctx || null;
    return this.reloadNow("attachContext");
  }

  get() {
    return this.current;
  }

  getStorageKey() {
    return CONFIG_KEY;
  }

  reloadNow(reason) {
    const ctx = this._ctx;
    if (!ctx || !ctx.globalState || typeof ctx.globalState.get !== "function") {
      this.lastError = new Error("config storage not ready (missing extension context)");
      this.current = this.lastGood;
      debug(`config reload skipped (${reason}): no ctx`);
      return { ok: false, reason: "no_ctx" };
    }

    try {
      const raw = ctx.globalState.get(CONFIG_KEY);
      if (!raw) {
        this.lastError = new Error("config missing (will initialize defaults on next save)");
        this.current = this.lastGood;
        debug(`config missing (${reason})`);
        return { ok: false, reason: "missing" };
      }
      const cfg = normalizeConfig(raw);
      this.current = cfg;
      this.lastGood = cfg;
      this.lastError = null;

      try {
        syncByokAuthState({ commands: this._ctx?.vscode?.commands || require("vscode").commands });
      } catch {}

      debug(`config loaded (${reason})`);
      return { ok: true };
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      this.current = this.lastGood;
      warn(`config load failed (${reason}): ${this.lastError.message}`);
      return { ok: false, reason: "error", error: this.lastError };
    }
  }

  async saveNow(raw, reason) {
    const ctx = this._ctx;
    if (!ctx || !ctx.globalState || typeof ctx.globalState.update !== "function") throw new Error("config storage not ready (missing globalState)");
    const cfg = normalizeConfig(raw);
    await ctx.globalState.update(CONFIG_KEY, cfg);
    this.current = cfg;
    this.lastGood = cfg;
    this.lastError = null;

    try {
      syncByokAuthState({ commands: require("vscode").commands });
    } catch {}

    debug(`config saved (${normalizeString(reason) || "save"})`);
    return { ok: true, config: cfg };
  }

  async resetNow(reason) {
    return await this.saveNow(defaultConfig(), normalizeString(reason) || "reset");
  }
}

function createConfigManager(opts) {
  const mgr = new ConfigManager();
  const ctx = opts && typeof opts === "object" ? opts.ctx : null;
  if (ctx) mgr.attachContext(ctx);
  return mgr;
}

module.exports = { defaultConfig, normalizeConfig, createConfigManager };
