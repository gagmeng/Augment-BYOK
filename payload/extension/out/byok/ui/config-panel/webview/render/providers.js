(function () {
  "use strict";

  const ns = (window.__byokCfgPanel = window.__byokCfgPanel || {});
  const { normalizeStr, uniq, escapeHtml, optionHtml, validateProviderDraft, pickIssueByKey, defaultBaseUrlForProviderType } = ns;

  const KNOWN_PROVIDER_TYPES = Array.isArray(ns.KNOWN_PROVIDER_TYPES) ? ns.KNOWN_PROVIDER_TYPES : [];

  function issueUi(issue) {
    const it = issue && typeof issue === "object" ? issue : null;
    if (!it || !it.level) return { cls: "field-msg hidden", inputCls: "", text: "" };
    const lvl = it.level === "error" ? "error" : "warning";
    return {
      cls: `field-msg field-msg--${lvl}`,
      inputCls: lvl === "error" ? "input--error" : "input--warning",
      text: String(it.message || "")
    };
  }

  function computeThinkingUi({ type, requestDefaults }) {
    const rd = requestDefaults && typeof requestDefaults === "object" && !Array.isArray(requestDefaults) ? requestDefaults : {};

    if (type === "openai_responses") {
      const reasoning = rd.reasoning && typeof rd.reasoning === "object" && !Array.isArray(rd.reasoning) ? rd.reasoning : {};
      const raw = normalizeStr(reasoning.effort);
      const rawNorm = raw.replace(/[\s-]+/g, "_");
      const v =
        rawNorm === "xhigh"
          ? "xhigh"
          : rawNorm === "low" || rawNorm === "medium" || rawNorm === "high"
            ? rawNorm
            : rawNorm
              ? "custom"
              : "";
      const hint =
        v === "xhigh" ? "OpenAI Responses：reasoning.effort=xhigh" : "OpenAI Responses：reasoning.effort=low|medium|high|xhigh";
      return { supported: true, value: v, hint };
    }

    if (type === "anthropic") {
      const thinking = rd.thinking && typeof rd.thinking === "object" && !Array.isArray(rd.thinking) ? rd.thinking : null;
      const tType = normalizeStr(thinking && thinking.type);
      const btRaw = thinking ? (thinking.budget_tokens ?? thinking.budgetTokens) : undefined;
      const bt = Number(btRaw);
      let v = "";
      if (thinking) {
        if (tType !== "enabled") v = "custom";
        else if (bt === 1024) v = "low";
        else if (bt === 2048) v = "medium";
        else if (bt === 4096) v = "high";
        else if (bt === 8192) v = "xhigh";
        else v = "custom";
      }
      return { supported: true, value: v, hint: "Anthropic：写入 requestDefaults.thinking.budget_tokens（Low/Medium/High/xhigh）" };
    }

    return { supported: false, value: "", hint: "该类型不支持（可用 Defaults JSON 自定义）" };
  }

  ns.renderProvidersPanel = function renderProvidersPanel({ providers, providerExpanded } = {}) {
    const listProviders = Array.isArray(providers) ? providers : [];
    const expanded = providerExpanded && typeof providerExpanded === "object" && !Array.isArray(providerExpanded) ? providerExpanded : {};

    const list = listProviders
      .map((p, idx) => {
        const pid = normalizeStr(p?.id);
        const pKey = pid || `idx:${idx}`;
        const type = normalizeStr(p?.type);
        const baseUrl = normalizeStr(p?.baseUrl);
        const baseUrlPlaceholder = normalizeStr(typeof defaultBaseUrlForProviderType === "function" ? defaultBaseUrlForProviderType(type) : "") || "https://api.openai.com/v1";
        const apiKeySet = Boolean(normalizeStr(p?.apiKey));
        const dm = normalizeStr(p?.defaultModel);
        const rawModels = Array.isArray(p?.models) ? p.models : [];
        const models = uniq(rawModels.filter((m) => normalizeStr(m)));
        const modelOptions = uniq(models.concat(dm ? [dm] : []));
        const requestDefaults = p?.requestDefaults && typeof p.requestDefaults === "object" && !Array.isArray(p.requestDefaults) ? p.requestDefaults : {};
        const thinkingUi = computeThinkingUi({ type, requestDefaults });

        const issues =
          typeof validateProviderDraft === "function" ? validateProviderDraft({ id: pid, type, baseUrl, models, defaultModel: dm }) : [];
        const idIssue = issueUi(typeof pickIssueByKey === "function" ? pickIssueByKey(issues, "id") : null);
        const typeIssue = issueUi(typeof pickIssueByKey === "function" ? pickIssueByKey(issues, "type") : null);
        const baseUrlIssue = issueUi(typeof pickIssueByKey === "function" ? pickIssueByKey(issues, "baseUrl") : null);
        const modelsIssue = issueUi(typeof pickIssueByKey === "function" ? pickIssueByKey(issues, "models") : null);

        const providerTitle = pid || `provider_${idx + 1}`;
        const isExpanded = pKey in expanded ? expanded[pKey] === true : idx === 0;
        const headerBadges = [
          idx === 0 ? `<span class="status-badge status-badge--success">default</span>` : "",
          type ? `<span class="status-badge${typeIssue.inputCls === "input--error" ? " status-badge--error" : typeIssue.inputCls === "input--warning" ? " status-badge--warning" : ""}">${escapeHtml(type)}</span>` : "",
          models.length ? `<span class="status-badge">models: ${escapeHtml(String(models.length))}</span>` : `<span class="status-badge status-badge--warning">models: 0</span>`,
          baseUrlIssue.inputCls === "input--error"
            ? `<span class="status-badge status-badge--error">baseUrl: invalid</span>`
            : baseUrlIssue.inputCls === "input--warning"
              ? `<span class="status-badge status-badge--warning">baseUrl: check</span>`
              : baseUrl
                ? `<span class="status-badge status-badge--success">baseUrl: ok</span>`
                : `<span class="status-badge status-badge--warning">baseUrl: empty</span>`,
          apiKeySet ? `<span class="status-badge status-badge--success">key: set</span>` : `<span class="status-badge status-badge--warning">key: empty</span>`
        ]
          .filter(Boolean)
          .join("");

        return `
            <div class="provider-card${isExpanded ? " is-expanded" : ""}" data-provider-card data-provider-idx="${idx}" data-provider-key="${escapeHtml(pKey)}">
              <div class="provider-card__header" data-action="toggleProviderCard" data-idx="${idx}">
                <div class="flex-row flex-wrap">
                  <span class="icon-chevron">▶</span>
                  <strong class="text-mono">${escapeHtml(providerTitle)}</strong>
                  ${headerBadges}
                  ${baseUrl ? `<span class="text-muted text-xs text-mono">${escapeHtml(baseUrl)}</span>` : `<span class="text-muted text-xs">baseUrl: (empty)</span>`}
                </div>
                <div class="flex-row flex-wrap">
                  <button class="btn btn--small btn--success" data-action="makeProviderDefault" data-idx="${idx}" ${idx === 0 ? "disabled" : ""}><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>设为默认</button>
                  <button class="btn btn--small btn--danger" data-action="removeProvider" data-idx="${idx}"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>删除</button>
                </div>
              </div>
              <div class="provider-card__content-wrapper">
                <div class="provider-card__body">
                  <div class="provider-card__inner">
                    <div class="form-grid">
                      <div class="form-group">
                        <label class="form-label">ID</label>
                        <input type="text" class="${idIssue.inputCls}" data-p-idx="${idx}" data-p-key="id" value="${escapeHtml(pid)}" placeholder="openai" />
                        <div class="${idIssue.cls}" data-provider-idx="${idx}" data-provider-issue-for="id">${escapeHtml(idIssue.text)}</div>
                      </div>
                      <div class="form-group">
                        <label class="form-label">Type</label>
                        <select class="${typeIssue.inputCls}" data-p-idx="${idx}" data-p-key="type">
                          ${type && !KNOWN_PROVIDER_TYPES.includes(type) ? optionHtml({ value: type, label: `${type} (unknown)`, selected: true }) : ""}
                          ${KNOWN_PROVIDER_TYPES.map((t) => optionHtml({ value: t, label: t, selected: type === t })).join("")}
                        </select>
                        <div class="${typeIssue.cls}" data-provider-idx="${idx}" data-provider-issue-for="type">${escapeHtml(typeIssue.text)}</div>
                      </div>
                      <div class="form-group form-grid--full">
                        <div class="flex-between flex-row">
                          <label class="form-label">Base URL</label>
                          <button class="btn btn--small btn--purple" data-action="setProviderBaseUrlDefault" data-idx="${idx}" title="使用该 Type 的默认 Base URL"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>默认</button>
                        </div>
                        <input type="url" class="${baseUrlIssue.inputCls}" data-p-idx="${idx}" data-p-key="baseUrl" value="${escapeHtml(baseUrl)}" placeholder="${escapeHtml(baseUrlPlaceholder)}" />
                        <div class="${baseUrlIssue.cls}" data-provider-idx="${idx}" data-provider-issue-for="baseUrl">${escapeHtml(baseUrlIssue.text)}</div>
                        <div class="text-muted text-xs">必须是 http(s) URL。示例：<span class="text-mono">${escapeHtml(baseUrlPlaceholder)}</span></div>
                      </div>
                      <div class="form-group form-grid--full">
                        <div class="flex-between flex-row">
                          <label class="form-label">API Key</label>
                          ${apiKeySet ? `<span class="status-badge status-badge--success">set</span>` : `<span class="status-badge status-badge--warning">empty</span>`}
                        </div>
                        <div class="flex-row">
                          <input type="password" data-p-idx="${idx}" data-p-key="apiKeyInput" value="" placeholder="${apiKeySet ? "(set)" : "(empty)"}" />
                          <button class="btn btn--icon btn--danger" data-action="clearProviderKey" data-idx="${idx}" title="清空 API Key">✕</button>
                        </div>
                      </div>
                      <div class="form-group">
                        <label class="form-label">Models</label>
                        <div class="flex-row flex-wrap">
                          <span class="status-badge">${escapeHtml(String(models.length))}</span>
                          <button class="btn btn--small btn--teal" data-action="fetchProviderModels" data-idx="${idx}"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>拉取</button>
                          <button class="btn btn--small btn--info" data-action="editProviderModels" data-idx="${idx}"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>编辑</button>
                        </div>
                        <div class="${modelsIssue.cls}" data-provider-idx="${idx}" data-provider-issue-for="models">${escapeHtml(modelsIssue.text)}</div>
                      </div>
                      <div class="form-group">
                        <label class="form-label">Default Model</label>
                        <select data-p-idx="${idx}" data-p-key="defaultModel">
                          ${optionHtml({ value: "", label: "(auto)", selected: !dm })}
                          ${modelOptions.map((m) => optionHtml({ value: m, label: m, selected: dm === m })).join("")}
                        </select>
                      </div>
                      <div class="form-group">
                        <label class="form-label">思考等级</label>
                        <select data-p-idx="${idx}" data-p-key="thinkingLevel" ${thinkingUi.supported ? "" : "disabled"}>
                          ${optionHtml({ value: "", label: "(Default)", selected: thinkingUi.value === "" })}
                          ${optionHtml({ value: "low", label: "Low", selected: thinkingUi.value === "low" })}
                          ${optionHtml({ value: "medium", label: "Medium", selected: thinkingUi.value === "medium" })}
                          ${optionHtml({ value: "high", label: "High", selected: thinkingUi.value === "high" })}
                          ${optionHtml({ value: "xhigh", label: "xhigh", selected: thinkingUi.value === "xhigh" })}
                          ${thinkingUi.value === "custom" ? optionHtml({ value: "custom", label: "(Custom / keep)", selected: true }) : ""}
                        </select>
                        <div class="text-muted text-xs">${escapeHtml(thinkingUi.hint)}</div>
                      </div>
                      <div class="form-group form-grid--full">
                        <label class="form-label">Advanced</label>
                        <div class="flex-row flex-wrap">
                          <button class="btn btn--small btn--pink" data-action="editProviderHeaders" data-idx="${idx}"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>Headers</button>
                          <button class="btn btn--small btn--purple" data-action="editProviderRequestDefaults" data-idx="${idx}"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>Defaults</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
      })
      .join("");

    return `
        <section class="settings-panel">
          <header class="settings-panel__header">
            <div class="flex-row"><svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg> <span class="section-title">Providers</span></div>
            <div class="flex-row flex-wrap">
              <button class="btn btn--small btn--primary" data-action="addProvider"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>新增 Provider</button>
            </div>
          </header>
          <div class="settings-panel__body">
            <div class="text-muted text-xs">约定：列表第 1 个（<span class="text-mono">providers[0]</span>）为默认 BYOK provider。</div>
            <div style="height:8px;"></div>
            <div class="provider-list">
              ${list || `<div class="text-muted" style="text-align:center;padding:20px;">暂无 Provider，请点击右上角新增。</div>`}
            </div>
          </div>
        </section>
      `;
  };
})();
