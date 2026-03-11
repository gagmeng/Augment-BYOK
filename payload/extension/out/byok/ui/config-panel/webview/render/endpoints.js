(function () {
  "use strict";

  const ns = (window.__byokCfgPanel = window.__byokCfgPanel || {});
  const { normalizeStr, uniq, escapeHtml, optionHtml, computeProviderIndexById } = ns;

  ns.renderEndpointRulesPanel = function renderEndpointRulesPanel({ cfg, endpointSearchText } = {}) {
    const c = cfg && typeof cfg === "object" ? cfg : {};
    const routing = c.routing && typeof c.routing === "object" ? c.routing : {};
    const rulesObj = routing.rules && typeof routing.rules === "object" ? routing.rules : {};
    const endpointSearch = normalizeStr(endpointSearchText);

    const providers = Array.isArray(c.providers) ? c.providers : [];
    const providerIds = providers.map((p) => normalizeStr(p?.id)).filter(Boolean);
    const providerMap = computeProviderIndexById(c);

    const catalog = typeof ns.getEndpointCatalogV1 === "function" ? ns.getEndpointCatalogV1() : { groups: [], meanings: {}, llmEndpoints: [] };
    const ENDPOINT_GROUPS_V1 = Array.isArray(catalog.groups) ? catalog.groups : [];
    const ENDPOINT_MEANINGS_V1 = catalog.meanings && typeof catalog.meanings === "object" ? catalog.meanings : {};

    const ruleEndpoints = Object.keys(rulesObj).sort();
    const knownEndpoints = uniq(ENDPOINT_GROUPS_V1.flatMap((g) => (Array.isArray(g?.endpoints) ? g.endpoints : [])));
    const knownEndpointSet = new Set(knownEndpoints);
    const unknownRuleEndpoints = uniq(ruleEndpoints.filter((ep) => ep && !knownEndpointSet.has(ep)));

    const byokSupportedSet = new Set(Array.isArray(catalog.llmEndpoints) ? catalog.llmEndpoints : []);

    const endpointGroups = ENDPOINT_GROUPS_V1.concat(
      unknownRuleEndpoints.length
        ? [{ id: "other_from_config", label: "其他（来自配置）", endpoints: unknownRuleEndpoints }]
        : []
    );

    const defaultModeLabel = "default (official)";

    const endpointGroupsHtml = endpointGroups
      .map((g) => {
        const endpoints = Array.isArray(g?.endpoints) ? g.endpoints : [];
        const overrideCount = endpoints.filter((ep) => {
          const r = rulesObj[ep] && typeof rulesObj[ep] === "object" ? rulesObj[ep] : null;
          const m = normalizeStr(r?.mode);
          return m === "official" || m === "byok" || m === "disabled";
        }).length;

        const openAttr = endpointSearch ? " open" : overrideCount ? " open" : "";

        const rows = endpoints
          .map((ep) => {
            const r = rulesObj[ep] && typeof rulesObj[ep] === "object" ? rulesObj[ep] : {};
            const mode = normalizeStr(r.mode);
            const modeIsByok = mode === "byok";
            const byokSupported = byokSupportedSet.has(ep);
            const byokUnsupportedActive = modeIsByok && !byokSupported;
            const providerId = normalizeStr(r.providerId);
            const model = normalizeStr(r.model);
            const models = providerId && providerMap[providerId] && Array.isArray(providerMap[providerId].models) ? providerMap[providerId].models : [];

            const providerIdUnknown = Boolean(providerId) && !providerMap[providerId];
            const providerSelectCls = providerIdUnknown ? "input--error" : "";
            const providerSelectTitle = providerIdUnknown ? `未知 providerId：${providerId}（不在 Providers 列表中；运行时会回退 official）` : "Only used when mode=byok";

            const modelUnknownForProvider =
              Boolean(model) && Boolean(providerId) && !providerIdUnknown && models.length > 0 && !models.includes(model);
            const modelSelectCls = modelUnknownForProvider ? "input--warning" : "";
            const modelSelectTitle = modelUnknownForProvider ? `Model 不在 provider(${providerId}) 的 Models 列表中（仍可保存/尝试）` : "Pick provider first (mode=byok)";

            const modeSelectCls = byokUnsupportedActive ? "input--warning" : "";
            const modeSelectTitle = byokUnsupportedActive
              ? "BYOK 只对 LLM 数据面端点生效；该 endpoint 选 byok 会回落 official（建议改为 official/disabled）。"
              : "";

            const providerDisabled = !modeIsByok || byokUnsupportedActive;
            const modelDisabled = providerDisabled || !providerId;
            const modelOptions = uniq(models.concat(model ? [model] : []));

            const desc = typeof ENDPOINT_MEANINGS_V1[ep] === "string" ? ENDPOINT_MEANINGS_V1[ep] : "";
            const byokDisabled = !byokSupported && mode !== "byok";

            return `
              <div class="endpoint-grid endpoint-row" data-endpoint-row="${escapeHtml(ep)}" data-endpoint-desc="${escapeHtml(desc)}">
                <div class="endpoint-meta">
                  <div class="mono">${escapeHtml(ep)}</div>
                  ${desc ? `<div class="small endpoint-desc">${escapeHtml(desc)}</div>` : ``}
                </div>
                <div>
                  <select class="${modeSelectCls}" data-rule-ep="${escapeHtml(ep)}" data-rule-key="mode"${modeSelectTitle ? ` title="${escapeHtml(modeSelectTitle)}"` : ""}>
                    ${optionHtml({ value: "", label: defaultModeLabel, selected: !mode })}
                    ${optionHtml({ value: "official", label: "official", selected: mode === "official" })}
                    ${optionHtml({ value: "byok", label: byokSupported ? "byok" : "byok (LLM only)", selected: mode === "byok", disabled: byokDisabled })}
                    ${optionHtml({ value: "disabled", label: "disabled (no-op)", selected: mode === "disabled" })}
                  </select>
                </div>
                <div>
                  <select class="${providerSelectCls}" data-rule-ep="${escapeHtml(ep)}" data-rule-key="providerId" ${providerDisabled ? `disabled title="${escapeHtml(providerSelectTitle)}"` : `title="${escapeHtml(providerSelectTitle)}"`}>
                    ${optionHtml({ value: "", label: "(auto / from model picker)", selected: !providerId })}
                    ${providerIdUnknown ? optionHtml({ value: providerId, label: `${providerId} (missing)`, selected: true }) : ""}
                    ${providerIds.map((id) => optionHtml({ value: id, label: id, selected: providerId === id })).join("")}
                  </select>
                </div>
                <div>
                  <select class="${modelSelectCls}" data-rule-ep="${escapeHtml(ep)}" data-rule-key="model" ${modelDisabled ? `disabled title="${escapeHtml(modelSelectTitle)}"` : `title="${escapeHtml(modelSelectTitle)}"`}>
                    ${optionHtml({ value: "", label: "(auto / from model picker)", selected: !model })}
                    ${modelOptions.map((m) => optionHtml({ value: m, label: m, selected: model === m })).join("")}
                  </select>
                </div>
              </div>
            `;
          })
          .join("");

        return `
	          <details class="endpoint-group" data-endpoint-group="${escapeHtml(g.id)}"${openAttr}>
	            <summary class="endpoint-group-summary">
	              <span>${escapeHtml(g.label)}</span>
	              <span class="row" style="gap:6px;">
	                <span class="badge">${escapeHtml(String(overrideCount))} overridden</span>
	                <span class="badge" data-endpoint-group-count-badge>${escapeHtml(String(endpoints.length))} total</span>
	              </span>
	            </summary>
	            <div class="endpoint-group-body">
	              <div class="endpoint-grid endpoint-grid-header small">
	                <div>endpoint</div>
                <div>mode</div>
                <div>provider</div>
                <div>model</div>
              </div>
              ${rows || `<div class="small">(empty)</div>`}
            </div>
          </details>
        `;
      })
      .join("");

    return `
	      <section class="settings-panel">
	        <header class="settings-panel__header">
	          <span>Endpoint Rules</span>
	          <span class="status-badge">${escapeHtml(String(knownEndpoints.length))} endpoints</span>
	        </header>
	        <div class="settings-panel__body">
	          <div class="text-muted text-xs">统一管理 endpoint 的 Routing / Disable；未设置默认 official；仅 LLM 数据面支持 byok。</div>
	          <div style="height:10px;"></div>
	          <div class="flex-row flex-wrap" style="margin-bottom:8px;">
	            <input type="search" id="endpointSearch" value="${escapeHtml(endpointSearch)}" placeholder="搜索 endpoint 或含义（支持子串过滤，例如 /record-、GitHub、token）" />
	            <span class="text-muted text-xs" id="endpointFilterCount"></span>
	          </div>
	          ${endpointGroupsHtml || `<div class="text-muted text-xs">(no endpoints)</div>`}
	        </div>
	      </section>
	    `;
  };
})();
