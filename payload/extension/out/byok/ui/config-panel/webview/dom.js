(function () {
  "use strict";

  const ns = window.__byokCfgPanel;
  if (
    !ns ||
    typeof ns.normalizeStr !== "function" ||
    typeof ns.uniq !== "function" ||
    typeof ns.parseModelsTextarea !== "function" ||
    typeof ns.parseJsonOrEmptyObject !== "function"
  ) {
    throw new Error("BYOK panel init failed (missing util)");
  }

  const { normalizeStr, uniq, parseModelsTextarea, parseJsonOrEmptyObject } = ns;

  function applyProvidersEditsFromDom(cfg) {
    const providers = Array.isArray(cfg.providers) ? cfg.providers : [];
    const els = Array.from(document.querySelectorAll("[data-p-idx][data-p-key]"));

    for (const el of els) {
      const idx = Number(el.getAttribute("data-p-idx"));
      const key = el.getAttribute("data-p-key");
      if (!Number.isFinite(idx) || idx < 0 || idx >= providers.length) continue;
      if (key === "apiKeyInput") continue;

      const p = providers[idx] && typeof providers[idx] === "object" ? providers[idx] : (providers[idx] = {});

      if (key === "models") {
        p.models = parseModelsTextarea(el.value);
        continue;
      }
      if (key === "headers") {
        try {
          p.headers = parseJsonOrEmptyObject(el.value);
        } catch {}
        continue;
      }
      if (key === "requestDefaults") {
        try {
          p.requestDefaults = parseJsonOrEmptyObject(el.value);
        } catch {}
        continue;
      }

      if (key === "thinkingLevel") {
        const level = normalizeStr(el.value);
        const providerType = normalizeStr(p.type);
        p.requestDefaults =
          p.requestDefaults && typeof p.requestDefaults === "object" && !Array.isArray(p.requestDefaults) ? p.requestDefaults : {};
        const rd = p.requestDefaults;

        if (providerType === "openai_responses") {
          if (level === "custom") continue;
          const effort = level;
          if (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh") {
            const reasoning = rd.reasoning && typeof rd.reasoning === "object" && !Array.isArray(rd.reasoning) ? rd.reasoning : {};
            reasoning.effort = effort;
            rd.reasoning = reasoning;
            try {
              delete rd.__byok_thinking_level;
            } catch {}
          } else {
            if (rd.reasoning && typeof rd.reasoning === "object" && !Array.isArray(rd.reasoning)) {
              try {
                delete rd.reasoning.effort;
              } catch {}
              if (Object.keys(rd.reasoning).length === 0) {
                try {
                  delete rd.reasoning;
                } catch {}
              }
            }
            try {
              delete rd.__byok_thinking_level;
            } catch {}
          }
          p.requestDefaults = rd;
          continue;
        }

        if (providerType === "anthropic") {
          if (level === "custom") continue;
          const budgetByLevel = { low: 1024, medium: 2048, high: 4096, xhigh: 8192 };
          const budget = budgetByLevel[level];
          if (budget) {
            const thinking = rd.thinking && typeof rd.thinking === "object" && !Array.isArray(rd.thinking) ? rd.thinking : {};
            thinking.type = "enabled";
            thinking.budget_tokens = budget;
            rd.thinking = thinking;
          } else {
            try {
              delete rd.thinking;
            } catch {}
          }
          p.requestDefaults = rd;
          continue;
        }

        continue;
      }

      p[key] = normalizeStr(el.value);
    }

    for (const el of els) {
      const idx = Number(el.getAttribute("data-p-idx"));
      const key = el.getAttribute("data-p-key");
      if (key !== "apiKeyInput") continue;
      const v = normalizeStr(el.value);
      if (v && providers[idx]) providers[idx].apiKey = v;
    }

    for (const p of providers) {
      const models = uniq((Array.isArray(p.models) ? p.models : []).concat(normalizeStr(p.defaultModel) ? [p.defaultModel] : []));
      p.models = models;
      if (!normalizeStr(p.defaultModel)) p.defaultModel = models[0] || "";
    }

    cfg.providers = providers;
  }

  function gatherSelfTestProviderKeysFromDom() {
    const els = Array.from(document.querySelectorAll("input[type=\"checkbox\"][data-selftest-provider-key]"));
    const keys = [];
    for (const el of els) {
      if (!el || typeof el.getAttribute !== "function") continue;
      if (!el.checked) continue;
      const key = normalizeStr(el.getAttribute("data-selftest-provider-key"));
      if (key) keys.push(key);
    }
    return uniq(keys);
  }

  function applyRulesEditsFromDom(cfg) {
    const routing = cfg.routing && typeof cfg.routing === "object" ? cfg.routing : (cfg.routing = {});
    const rules = routing.rules && typeof routing.rules === "object" ? routing.rules : (routing.rules = {});

    const els = Array.from(document.querySelectorAll("[data-rule-ep][data-rule-key]"));
    for (const el of els) {
      const ep = el.getAttribute("data-rule-ep");
      const key = el.getAttribute("data-rule-key");
      if (!ep || !key) continue;
      const r = rules[ep] && typeof rules[ep] === "object" ? rules[ep] : (rules[ep] = {});
      r[key] = normalizeStr(el.value);
    }

    routing.rules = rules;
    cfg.routing = routing;
  }

  ns.__byokCfgPanelDom = { applyProvidersEditsFromDom, gatherSelfTestProviderKeysFromDom, applyRulesEditsFromDom };
})();
