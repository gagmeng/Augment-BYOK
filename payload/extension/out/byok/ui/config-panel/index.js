"use strict";

const { debug, info, warn } = require("../../infra/log");
const { DEFAULT_SELF_TEST_TIMEOUT_MS } = require("../../infra/constants");
const { normalizeString, normalizeRawToken } = require("../../infra/util");
const { setRuntimeEnabled: setRuntimeEnabledPersisted } = require("../../config/state");
const { clearHistorySummaryCacheAll } = require("../../core/augment-history-summary/auto");
const { runSelfTest } = require("../../core/self-test/run");
const { fetchOfficialGetModels } = require("../../runtime/official/get-models");
const { fetchProviderModels } = require("../../providers/models");
const { renderConfigPanelHtml } = require("./html");
const { exportConfigWithDialog, importConfigWithDialog, runIoWithUiErrorBoundary } = require("../config-io");


function post(panel, msg) {
  try {
    panel.webview.postMessage(msg);
  } catch {}
}

function postStatus(panel, status) {
  post(panel, { type: "status", status: String(status || "") });
}

function postRender(panel, cfgMgr, state) {
  post(panel, { type: "render", config: cfgMgr.get(), runtimeEnabled: Boolean(state?.runtimeEnabled) });
}

function createHandlers({ vscode, ctx, cfgMgr, state, panel }) {
  let selfTestController = null;
  let selfTestRunning = false;

  return {
    init: async () => {
      postRender(panel, cfgMgr, state);
    },
    reload: async () => {
      const rr = cfgMgr.reloadNow("panel_reload");
      postStatus(panel, rr.ok ? "Reloaded (OK)." : `Reload failed (${rr.reason || "unknown"}) (kept last-good).`);
      postRender(panel, cfgMgr, state);
    },
    reloadWindow: async () => {
      try {
        const pick = await vscode.window.showWarningMessage(
          "这会重载 VS Code（用于真正重载插件/主面板）。建议优先选择“重启扩展宿主”。",
          { modal: true },
          "重启扩展宿主",
          "重载窗口"
        );
        if (pick === "重启扩展宿主") {
          await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
          return;
        }
        if (pick === "重载窗口") {
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
          return;
        }
        postStatus(panel, "Reload canceled.");
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        warn("reloadWindow failed:", m);
        postStatus(panel, `Reload failed: ${m}`);
      }
    },
    disableRuntime: async () => {
      await setRuntimeEnabledPersisted(ctx, false);
      info("BYOK disabled (rollback) via panel");
      postStatus(panel, "Runtime disabled (rollback to official).");
      postRender(panel, cfgMgr, state);
    },
    enableRuntime: async () => {
      await setRuntimeEnabledPersisted(ctx, true);
      info("BYOK enabled via panel");
      postStatus(panel, "Runtime enabled.");
      postRender(panel, cfgMgr, state);
    },
    reset: async () => {
      try {
        await cfgMgr.resetNow("panel_reset");
        postStatus(panel, "Reset to defaults (OK).");
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        warn("panel reset failed:", m);
        postStatus(panel, `Reset failed: ${m}`);
      }
      postRender(panel, cfgMgr, state);
    },
    save: async (msg) => {
      const raw = msg && typeof msg === "object" ? msg.config : null;
      try {
        await cfgMgr.saveNow(raw, "panel_save");
        postStatus(panel, "Saved (OK).");
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        warn("panel save failed:", m);
        postStatus(panel, `Save failed: ${m}`);
      }
      postRender(panel, cfgMgr, state);
    },
    exportConfig: async (msg) => {
      const cfg = msg && typeof msg === "object" && msg.config && typeof msg.config === "object" ? msg.config : cfgMgr.get();
      try {
        await runIoWithUiErrorBoundary(async () => {
          const r = await exportConfigWithDialog({ vscode, cfg, defaultFileName: "augment-byok.config.json" });
          if (!r.ok) {
            postStatus(panel, "Export canceled.");
            return;
          }
          postStatus(panel, "Exported (OK).");
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        postStatus(panel, `Export failed: ${m}`);
      }
    },
    importConfig: async (msg) => {
      const dirty = Boolean(msg && typeof msg === "object" && msg.dirty === true);
      try {
        await runIoWithUiErrorBoundary(async () => {
          const r = await importConfigWithDialog({ vscode, cfgMgr, requireConfirm: dirty, preserveSecretsByDefault: true });
          if (!r.ok) {
            postStatus(panel, "Import canceled.");
            return;
          }
          postStatus(panel, "Imported (OK).");
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        postStatus(panel, `Import failed: ${m}`);
      }
      postRender(panel, cfgMgr, state);
    },
    clearHistorySummaryCache: async () => {
      try {
        const n = await clearHistorySummaryCacheAll();
        postStatus(panel, n ? `Cleared history summary cache (${n}).` : "History summary cache already empty.");
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        warn("panel clearHistorySummaryCache failed:", m);
        postStatus(panel, `Clear history summary cache failed: ${m}`);
      }
      postRender(panel, cfgMgr, state);
    },
    fetchProviderModels: async (msg) => {
      const idx = Number(msg?.idx);
      const provider = msg?.provider;
      const requestId = normalizeString(msg?.requestId);
      if (requestId) debug("panel fetchProviderModels", { idx, requestId });
      try {
        const models = await fetchProviderModels({ provider, timeoutMs: 15000 });
        if (requestId) debug("panel fetchProviderModels OK", { idx, requestId, modelsCount: Array.isArray(models) ? models.length : 0 });
        post(panel, { type: "providerModelsFetched", idx, models, ...(requestId ? { requestId } : {}) });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        warn("fetchProviderModels failed:", requestId ? { idx, requestId, error: m } : m);
        post(panel, { type: "providerModelsFailed", idx, ...(requestId ? { requestId } : {}), error: `Fetch models failed: ${m}` });
      }
    },
    testOfficialGetModels: async (msg) => {
      const requestId = normalizeString(msg?.requestId);
      const cfg = msg && typeof msg === "object" && msg.config && typeof msg.config === "object" ? msg.config : cfgMgr.get();
      const off = cfg?.official && typeof cfg.official === "object" ? cfg.official : {};
      const completionUrl = normalizeString(off.completionUrl) || "https://ace.cctv.mba/";
      const apiToken = normalizeRawToken(off.apiToken);

      try {
        const startedAtMs = Date.now();
        const json = await fetchOfficialGetModels({ completionURL: completionUrl, apiToken, timeoutMs: 12000 });

        const defaultModel = normalizeString(json.default_model ?? json.defaultModel);
        const modelsCount = Array.isArray(json.models) ? json.models.length : 0;
        const featureFlagsCount =
          json.feature_flags && typeof json.feature_flags === "object" && !Array.isArray(json.feature_flags) ? Object.keys(json.feature_flags).length : 0;

        const elapsedMs = Date.now() - startedAtMs;
        if (requestId) debug("panel testOfficialGetModels OK", { requestId, modelsCount, featureFlagsCount, elapsedMs });

        post(panel, {
          type: "officialGetModelsOk",
          ...(requestId ? { requestId } : {}),
          modelsCount,
          defaultModel,
          featureFlagsCount,
          elapsedMs
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        warn("testOfficialGetModels failed:", requestId ? { requestId, error: m } : m);
        post(panel, { type: "officialGetModelsFailed", ...(requestId ? { requestId } : {}), error: `Official /get-models failed: ${m}` });
      }
    },
    cancelSelfTest: async () => {
      if (!selfTestRunning || !selfTestController) {
        postStatus(panel, "Self Test not running.");
        return;
      }
      try {
        selfTestController.abort(new Error("Self Test canceled by user"));
      } catch {}
      postStatus(panel, "Self Test canceled.");
    },
    runSelfTest: async (msg) => {
      if (selfTestRunning) {
        postStatus(panel, "Self Test already running.");
        return;
      }
      const requestId = normalizeString(msg?.requestId);
      const providerKeysRaw = msg && typeof msg === "object" ? msg.providerKeys : null;
      const providerKeys = Array.isArray(providerKeysRaw) ? providerKeysRaw : [];
      const cfg = msg && typeof msg === "object" && msg.config && typeof msg.config === "object" ? msg.config : cfgMgr.get();
      const timeoutMs = DEFAULT_SELF_TEST_TIMEOUT_MS;

      selfTestRunning = true;
      selfTestController = new AbortController();
      if (requestId) debug("panel runSelfTest", { requestId });
      post(panel, { type: "selfTestStarted", ...(requestId ? { requestId } : {}), startedAtMs: Date.now() });
      postStatus(panel, "Self Test started...");

      try {
        await runSelfTest({
          cfg,
          timeoutMs,
          abortSignal: selfTestController.signal,
          providerKeys,
          onEvent: (ev) => {
            const t = normalizeString(ev?.type);
            if (t === "log") post(panel, { type: "selfTestLog", ...(requestId ? { requestId } : {}), line: String(ev?.line || "") });
            else if (t === "done") post(panel, { type: "selfTestDone", ...(requestId ? { requestId } : {}), report: ev?.report || null });
          }
        });
        postStatus(panel, "Self Test finished.");
      } catch (err) {
        if (err && typeof err === "object" && err.name === "AbortError") {
          post(panel, { type: "selfTestCanceled", ...(requestId ? { requestId } : {}) });
          postStatus(panel, "Self Test canceled.");
          return;
        }
        const m = err instanceof Error ? err.message : String(err);
        warn("selfTest failed:", requestId ? { requestId, error: m } : m);
        post(panel, { type: "selfTestFailed", ...(requestId ? { requestId } : {}), error: m });
        postStatus(panel, `Self Test failed: ${m}`);
      } finally {
        selfTestRunning = false;
        selfTestController = null;
      }
    }
  };
}

async function openConfigPanel({ vscode, ctx, cfgMgr, state }) {
  if (!vscode) throw new Error("vscode not available");
  if (!ctx) throw new Error("extension context not available");
  if (!cfgMgr || typeof cfgMgr.get !== "function") throw new Error("cfgMgr missing");

  const uiRoot = vscode.Uri.joinPath(ctx.extensionUri, "out", "byok", "ui", "config-panel");
  const panel = vscode.window.createWebviewPanel("augment-byok.config", "BYOK Config", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [uiRoot]
  });

  panel.webview.html = renderConfigPanelHtml({
    vscode,
    webview: panel.webview,
    ctx,
    init: { config: cfgMgr.get(), runtimeEnabled: Boolean(state?.runtimeEnabled) }
  });

  const handlers = createHandlers({ vscode, ctx, cfgMgr, state, panel });
  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
      if (!Object.prototype.hasOwnProperty.call(msg, "type")) return;

      const t = normalizeString(msg.type);
      if (!t) return;
      if (!Object.prototype.hasOwnProperty.call(handlers, t)) return;

      const fn = handlers[t];
      if (typeof fn !== "function") return;
      await fn(msg);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      warn("panel onDidReceiveMessage failed:", m);
      postStatus(panel, "消息处理器异常（已忽略）。");
    }
  });

  postRender(panel, cfgMgr, state);
  return panel;
}

module.exports = { openConfigPanel };
