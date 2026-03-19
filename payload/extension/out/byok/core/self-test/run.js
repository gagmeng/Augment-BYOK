"use strict";

const { debug } = require("../../infra/log");
const { nowMs } = require("../../infra/trace");
const { normalizeString, randomId } = require("../../infra/util");
const { captureAugmentToolDefinitions, getLastCapturedToolDefinitions } = require("../../config/state");
const { summarizeToolDefs } = require("./tool-defs");
const { getByokUpstreamGlobals, fetchLocalToolDefinitionsFromUpstream, selfTestToolsModelExec } = require("./tools-model");
const { summarizeCapturedToolsSchemas } = require("./tools-schema");
const { hasAuthHeader, formatMs, withTimed } = require("./util");
const { selfTestProvider } = require("./provider-test");
const { selfTestHistorySummary } = require("./history-summary-test");
const { convertToolDefinitionsByProviderType } = require("../provider-augment-chat");
const { validateConvertedToolsForProvider } = require("./provider-io");

function selfTestOpenAiResponsesSchemaCompatibility(log) {
  const defs = [
    {
      name: "schema_self_test",
      input_schema: {
        type: "object",
        properties: {
          a: { type: "string" },
          insert_line_1: { type: "integer" }
        },
        required: ["a"]
      }
    }
  ];
  const tools = convertToolDefinitionsByProviderType("openai_responses", defs);
  const p0 = tools?.[0]?.parameters;
  const props = p0 && typeof p0 === "object" && p0.properties && typeof p0.properties === "object" ? Object.keys(p0.properties) : [];
  const req = Array.isArray(p0?.required) ? p0.required : [];
  const ok = p0 && (p0.additionalProperties == null || p0.additionalProperties === false) && req.includes("a") && !req.includes("insert_line_1");
  log(`[responses schema] additionalProperties=${String(p0?.additionalProperties)} required=${req.length} props=${props.length}`);
  return ok;
}

async function runSelfTest({ cfg, timeoutMs, abortSignal, providerKeys, onEvent } = {}) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const providers = Array.isArray(c.providers) ? c.providers : [];
  const providerKeysRaw = Array.isArray(providerKeys) ? providerKeys : [];
  const selectedProviderKeys = providerKeysRaw.map((k) => normalizeString(k)).filter(Boolean);
  const selectedProviderKeySet = new Set(selectedProviderKeys);
  const providerKeyByIndex = (p, idx) => normalizeString(p?.id) || `idx:${idx}`;
  const providersToTest = selectedProviderKeySet.size ? providers.filter((p, idx) => selectedProviderKeySet.has(providerKeyByIndex(p, idx))) : providers;
  const t = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Math.floor(Number(timeoutMs)) : 30000;
  const runId = randomId();
  const runLabel = `run=${runId}`;

  const report = {
    runId,
    startedAtMs: nowMs(),
    finishedAtMs: 0,
    ok: true,
    global: { tests: [], capturedTools: null },
    providers: []
  };

  const emit = (ev) => {
    try {
      if (typeof onEvent === "function") onEvent(ev);
    } catch { }
  };
  const log = (line) => emit({ type: "log", line: String(line || "") });

  log("Self Test started.");
  debug(
    `[self-test] start ${runLabel} providers=${providers.length} providersToTest=${providersToTest.length} timeoutMs=${t}`
  );

  const captured = getLastCapturedToolDefinitions();
  const capturedDefs0 = Array.isArray(captured?.toolDefinitions) ? captured.toolDefinitions : [];
  const capturedMeta0 = captured?.meta && typeof captured.meta === "object" ? captured.meta : null;
  const capturedAtMs0 = Number(captured?.capturedAtMs) || 0;

  let toolDefsForSelfTest = capturedDefs0;
  let toolDefsSource = capturedDefs0.length ? "captured" : "none";
  let toolDefsMeta = capturedMeta0;
  let toolDefsCapturedAtMs = capturedAtMs0;

  // captured tools 为空时，优先尝试从上游 toolsModel 直接获取（覆盖“真实环境”的本地/远程工具全集）
  if (!toolDefsForSelfTest.length) {
    log("[captured tools] none → 尝试从上游 toolsModel 直接拉取真实工具定义…");
    const localRes = await withTimed(`${runLabel} capturedTools.fetchFromUpstream`, async () => await fetchLocalToolDefinitionsFromUpstream({ timeoutMs: Math.min(20000, t), abortSignal, log }));
    if (localRes.ok && Array.isArray(localRes.res?.defs) && localRes.res.defs.length) {
      toolDefsForSelfTest = localRes.res.defs;
      toolDefsSource = "upstream(toolsModel)";
      toolDefsMeta = localRes.res.meta || null;
      toolDefsCapturedAtMs = Number(localRes.res.meta?.capturedAtMs) || nowMs();
      try {
        const convFromUpstream = normalizeString(getByokUpstreamGlobals().upstream?.augmentExtension?._checkpointManager?.currentConversationId);
        captureAugmentToolDefinitions(toolDefsForSelfTest, {
          ...(toolDefsMeta || {}),
          ...(convFromUpstream ? { conversationId: convFromUpstream } : {}),
          capturedBy: "self-test"
        });
      } catch { }
      log(`[captured tools] fetched count=${toolDefsForSelfTest.length} via ${toolDefsSource}`);
    } else {
      const msg = localRes.ok ? normalizeString(localRes.res?.detail) || "empty tool list" : localRes.error;
      log(`[captured tools] upstream toolsModel fetch failed: ${msg}`);
    }
  }

  if (!toolDefsForSelfTest.length) {
    log(
      "[captured tools] none（无法从上游 toolsModel 自动拉取；请确认你安装的是 dist/*.byok.vsix 打包版且 extension.js 已注入 __augment_byok_expose_upstream_v1；或先跑一次 Agent /chat-stream 以捕获 tool_definitions）"
    );
  }

  const capturedSummary = summarizeToolDefs(toolDefsForSelfTest);
  const capturedAgeMs = toolDefsCapturedAtMs ? Math.max(0, nowMs() - Number(toolDefsCapturedAtMs)) : 0;
  report.global.capturedTools = {
    count: capturedSummary.count,
    capturedAtMs: toolDefsCapturedAtMs,
    ageMs: capturedSummary.count ? capturedAgeMs : 0,
    meta: toolDefsMeta,
    source: toolDefsSource,
    namesPreview: capturedSummary.names
  };

  if (capturedSummary.count) {
    log(`[captured tools] count=${capturedSummary.count} age=${formatMs(capturedAgeMs)} source=${toolDefsSource} names=${capturedSummary.names.join(",")}${capturedSummary.namesTruncated ? ",…" : ""}`);
    report.global.tests.push({ name: "capturedToolsAvailable", ok: true, detail: `count=${capturedSummary.count} source=${toolDefsSource}` });
  } else {
    report.global.tests.push({
      name: "capturedToolsAvailable",
      ok: false,
      detail: "未捕获到真实 tool_definitions 且无法自动拉取；Self Test 无法覆盖真实工具集"
    });
    report.ok = false;
  }

  // captured tools：schema 可解析性/可 JSON 化（不执行工具）
  if (toolDefsForSelfTest.length) {
    const schemaSum = summarizeCapturedToolsSchemas(toolDefsForSelfTest);
    const ok = schemaSum.sampleOk === schemaSum.toolCount;
    report.global.tests.push({
      name: "capturedToolsSchemaSamples",
      ok,
      detail: `sampleable=${schemaSum.sampleOk}/${schemaSum.toolCount} mcpMeta=${schemaSum.withMcpMeta}${schemaSum.sampleFailedNames.length ? ` failed=${schemaSum.sampleFailedNames.join(",")}${schemaSum.sampleFailedTruncated ? ",…" : ""}` : ""}`
    });
    log(
      `[captured tools schema] sampleable=${schemaSum.sampleOk}/${schemaSum.toolCount} mcpMeta=${schemaSum.withMcpMeta}${schemaSum.sampleFailedNames.length ? ` failed=${schemaSum.sampleFailedNames.join(",")}${schemaSum.sampleFailedTruncated ? ",…" : ""}` : ""}`
    );
    if (!ok) report.ok = false;
  } else {
    report.global.tests.push({ name: "capturedToolsSchemaSamples", ok: true, detail: "skipped (no captured tools)" });
  }

  const localSchemaOk = selfTestOpenAiResponsesSchemaCompatibility(log);
  report.global.tests.push({ name: "responsesSchema", ok: Boolean(localSchemaOk) });
  if (!localSchemaOk) report.ok = false;

  if (toolDefsForSelfTest.length) {
    const capturedSchema = await withTimed(`${runLabel} responsesSchema(capturedTools)`, async () => {
      const tools = convertToolDefinitionsByProviderType("openai_responses", toolDefsForSelfTest);
      const v = validateConvertedToolsForProvider("openai_responses", tools);
      if (!v.ok) throw new Error(v.issues.slice(0, 10).join(" | "));
      return { tools: Array.isArray(tools) ? tools.length : 0 };
    });
    if (capturedSchema.ok) {
      report.global.tests.push({ name: "responsesSchema(capturedTools)", ok: true, ms: capturedSchema.ms, detail: `tools=${capturedSchema.res?.tools ?? "?"}` });
      log(`[responses schema][capturedTools] ok (${formatMs(capturedSchema.ms)}) tools=${capturedSchema.res?.tools ?? "?"}`);
    } else {
      report.global.tests.push({ name: "responsesSchema(capturedTools)", ok: false, ms: capturedSchema.ms, detail: capturedSchema.error });
      log(`[responses schema][capturedTools] FAIL (${formatMs(capturedSchema.ms)}) ${capturedSchema.error}`);
      report.ok = false;
    }
  } else {
    report.global.tests.push({ name: "responsesSchema(capturedTools)", ok: true, ms: 0, detail: "skipped (no captured tools)" });
  }

  // 真实工具执行：对真实环境的 tools 做一次“真实执行”验证（通过上游 toolsModel；会产生一定副作用/访问网络/打开浏览器）
  if (toolDefsForSelfTest.length) {
    const execRes = await withTimed(`${runLabel} toolsExec`, async () => await selfTestToolsModelExec({ toolDefinitions: toolDefsForSelfTest, timeoutMs: t, abortSignal, log }));
    if (execRes.ok) {
      const r = execRes.res && typeof execRes.res === "object" ? execRes.res : null;
      const ms = Number.isFinite(Number(r?.ms)) && Number(r?.ms) >= 0 ? Number(r.ms) : execRes.ms;
      const ok = Boolean(r?.ok);
      report.global.tests.push({ name: "toolsExec", ok, ms, detail: normalizeString(r?.detail) || "" });
      report.global.toolExec = {
        ok,
        ms,
        detail: normalizeString(r?.detail) || "",
        failedTools: Array.isArray(r?.failedTools) ? r.failedTools : [],
        failedToolsTruncated: Boolean(r?.failedToolsTruncated),
        toolResults: r?.toolResults && typeof r.toolResults === "object" ? r.toolResults : null
      };
      if (!ok) report.ok = false;
    } else {
      report.global.tests.push({ name: "toolsExec", ok: false, ms: execRes.ms, detail: execRes.error });
      report.ok = false;
    }
  } else {
    report.global.tests.push({ name: "toolsExec", ok: true, ms: 0, detail: "skipped (no tools)" });
  }

  const providerResults = [];
  for (const p of providersToTest) {
    const res = await selfTestProvider({ cfg: c, provider: p, timeoutMs: t, abortSignal, log, capturedToolDefinitions: toolDefsForSelfTest });
    providerResults.push(res);
    report.providers.push(res);
    if (!res.ok) report.ok = false;
  }

  // historySummary：用第一个可用 provider 作为 fallback（真实逻辑也是：hs.providerId 不配时 fallback 到当前 provider）
  const firstOkProvider = providersToTest.find(
    (p) => normalizeString(p?.type) && normalizeString(p?.baseUrl) && (normalizeString(p?.apiKey) || hasAuthHeader(p?.headers))
  );
  const fallbackProvider = firstOkProvider || providersToTest[0] || null;
  const fallbackModel = normalizeString(fallbackProvider?.defaultModel) || normalizeString(fallbackProvider?.models?.[0]) || "";
  if (fallbackProvider && fallbackModel) {
    const hsRes = await selfTestHistorySummary({ cfg: c, fallbackProvider, fallbackModel, timeoutMs: t, abortSignal, log });
    report.global.tests.push({ name: "historySummary", ok: Boolean(hsRes.ok), detail: hsRes.detail, ms: hsRes.ms });
    if (!hsRes.ok) report.ok = false;
  } else {
    report.global.tests.push({ name: "historySummary", ok: true, detail: "skipped (no provider configured)" });
  }

  report.finishedAtMs = nowMs();
  log(`Self Test finished. ok=${String(report.ok)}`);
  debug(`[self-test] done ${runLabel} providers=${report.providers.length} ok=${String(report.ok)} totalMs=${formatMs(report.finishedAtMs - report.startedAtMs)}`);
  emit({ type: "done", report });
  return report;
}

module.exports = { runSelfTest };
