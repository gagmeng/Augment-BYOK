"use strict";

const { debug } = require("../../infra/log");
const { nowMs } = require("../../infra/trace");
const { normalizeString, randomId } = require("../../infra/util");
const { fetchProviderModels } = require("../../providers/models");
const { STOP_REASON_TOOL_USE_REQUESTED } = require("../augment-protocol");
const { summarizeToolDefs } = require("./tool-defs");
const { hasAuthHeader, providerLabel, formatMs, formatMaybeInt, withTimed } = require("./util");
const { makeSelfTestToolDefinitions, makeToolResultNode, makeImageNode, makeBaseAugmentChatRequest } = require("./builders");
const { extractToolUsesFromNodes, extractTokenUsageFromNodes } = require("./stream");
const {
  pickProviderModel,
  completeTextByProvider,
  streamTextByProvider,
  convertToolsByProviderType,
  validateConvertedToolsForProvider,
  chatStreamByProvider
} = require("./provider-io");
const { realToolsToolRoundtripByProvider } = require("./real-tools-roundtrip");

async function selfTestProvider({ cfg: _cfg, provider, timeoutMs, abortSignal, log, capturedToolDefinitions }) {
  const t0 = nowMs();
  const pid = normalizeString(provider?.id) || "";
  const type = normalizeString(provider?.type);

  const entry = {
    providerId: pid,
    providerType: type,
    model: "",
    tests: [],
    ok: true,
    msTotal: 0
  };

  const record = (t) => {
    const test = t && typeof t === "object" ? t : { name: "unknown", ok: false, ms: 0, detail: "invalid test record" };
    entry.tests.push(test);
    if (test.ok === false) entry.ok = false;
    const badge = test.ok === true ? "ok" : "FAIL";
    const d = normalizeString(test.detail);
    log(`[${providerLabel(provider)}] ${test.name}: ${badge} (${formatMs(test.ms)})${d ? ` ${d}` : ""}`.trim());
    if (test.ok === false) {
      debug(`[self-test] ${providerLabel(provider)} ${test.name}: FAIL (${formatMs(test.ms)})${d ? ` ${d}` : ""}`.trim());
    }
  };

  try {
    const baseUrl = normalizeString(provider?.baseUrl);
    const apiKey = normalizeString(provider?.apiKey);
    const headers = provider?.headers && typeof provider.headers === "object" && !Array.isArray(provider.headers) ? provider.headers : {};
    const authOk = Boolean(apiKey) || hasAuthHeader(headers);
    if (!type || !baseUrl || !authOk) {
      record({
        name: "config",
        ok: false,
        ms: 0,
        detail: `type/baseUrl/auth 未配置完整（type=${type || "?"}, baseUrl=${baseUrl || "?"}, auth=${authOk ? "set" : "empty"}）`
      });
      log(`[${providerLabel(provider)}] done`);
      return entry;
    }

    log(`[${providerLabel(provider)}] start`);

    const modelsRes = await withTimed(async () => await fetchProviderModels({ provider, timeoutMs: Math.min(15000, timeoutMs), abortSignal }));
    if (modelsRes.ok) {
      const models = Array.isArray(modelsRes.res) ? modelsRes.res : [];
      record({ name: "models", ok: true, ms: modelsRes.ms, detail: `models=${models.length}` });
      entry.model = pickProviderModel(provider, models);
    } else {
      record({ name: "models", ok: false, ms: modelsRes.ms, detail: modelsRes.error });
      entry.model = pickProviderModel(provider, []);
    }

    const model = normalizeString(entry.model);
    if (!model) {
      record({ name: "model", ok: false, ms: 0, detail: "未找到可用 model（请配置 providers[].defaultModel 或 models[]）" });
      log(`[${providerLabel(provider)}] done`);
      return entry;
    }

    const completionRes = await withTimed(async () => {
      const text = await completeTextByProvider({
        provider,
        model,
        system: "You are running a connectivity self-test. Output only: OK",
        messages: [{ role: "user", content: "OK" }],
        timeoutMs,
        abortSignal
      });
      return text;
    });
    if (completionRes.ok && normalizeString(completionRes.res)) {
      record({ name: "completeText", ok: true, ms: completionRes.ms, detail: `len=${String(completionRes.res).length}` });
    } else {
      record({ name: "completeText", ok: false, ms: completionRes.ms, detail: completionRes.ok ? "empty output" : completionRes.error });
    }

    const streamRes = await withTimed(async () => {
      const text = await streamTextByProvider({
        provider,
        model,
        system: "You are running a streaming self-test. Output only: OK",
        messages: [{ role: "user", content: "OK" }],
        timeoutMs,
        abortSignal
      });
      return text;
    });
    if (streamRes.ok && normalizeString(streamRes.res)) {
      record({ name: "streamText", ok: true, ms: streamRes.ms, detail: `len=${String(streamRes.res).length}` });
    } else {
      record({ name: "streamText", ok: false, ms: streamRes.ms, detail: streamRes.ok ? "empty output" : streamRes.error });
    }

    // chat-stream（基础）
    const chatReq = makeBaseAugmentChatRequest({
      message: "Self-test: reply with OK-chat (no markdown).",
      conversationId: `byok-selftest-${randomId()}`,
      toolDefinitions: [],
      nodes: [],
      chatHistory: []
    });
    const chatRes = await withTimed(async () => await chatStreamByProvider({ provider, model, req: chatReq, timeoutMs, abortSignal }));
    if (chatRes.ok && (normalizeString(chatRes.res?.text) || (Array.isArray(chatRes.res?.nodes) && chatRes.res.nodes.length))) {
      const tu = extractTokenUsageFromNodes(chatRes.res?.nodes);
      const usage = tu
        ? ` tokens=${formatMaybeInt(tu.input_tokens ?? tu.inputTokens) || "?"}/${formatMaybeInt(tu.output_tokens ?? tu.outputTokens) || "?"} cached=${formatMaybeInt(tu.cache_read_input_tokens ?? tu.cacheReadInputTokens) || "0"}`
        : "";
      record({
        name: "chatStream",
        ok: true,
        ms: chatRes.ms,
        detail: `textLen=${String(chatRes.res?.text || "").length} nodes=${Array.isArray(chatRes.res?.nodes) ? chatRes.res.nodes.length : 0}${usage}`
      });
    } else {
      record({ name: "chatStream", ok: false, ms: chatRes.ms, detail: chatRes.ok ? "empty output" : chatRes.error });
    }

    // 真实环境工具集：schema 校验 + tool_use/tool_result 往返（不执行真实工具，仅验证“真实工具集”能跑通工具链路/配对）
    const realToolDefs = Array.isArray(capturedToolDefinitions) ? capturedToolDefinitions : [];
    if (realToolDefs.length) {
      const sum = summarizeToolDefs(realToolDefs);
      const schemaRes = await withTimed(async () => {
        const converted = convertToolsByProviderType(type, realToolDefs);
        const v = validateConvertedToolsForProvider(type, converted);
        if (!v.ok) throw new Error(v.issues.slice(0, 8).join(" | "));
        return { convertedCount: Array.isArray(converted) ? converted.length : 0, firstNames: sum.names };
      });
      if (schemaRes.ok) {
        record({
          name: "realToolsSchema",
          ok: true,
          ms: schemaRes.ms,
          detail: `tools=${sum.count} converted=${schemaRes.res?.convertedCount ?? "?"} names=${sum.names.join(",")}${sum.namesTruncated ? ",…" : ""}`
        });
      } else {
        record({ name: "realToolsSchema", ok: false, ms: schemaRes.ms, detail: schemaRes.error });
      }

      // 真实工具可用性：在真实工具 schema 下触发 tool_use + tool_result 往返（不执行真实工具；全量验证工具链路/配对逻辑对真实工具集可用）
      const realToolsRoundtripRes = await withTimed(
        async () => await realToolsToolRoundtripByProvider({ provider, model, toolDefinitions: realToolDefs, timeoutMs, abortSignal, log, maxTools: 9999 })
      );
      if (realToolsRoundtripRes.ok && realToolsRoundtripRes.res?.ok) {
        record({ name: "realToolsToolRoundtrip", ok: true, ms: realToolsRoundtripRes.ms, detail: realToolsRoundtripRes.res?.detail || "" });
      } else {
        record({
          name: "realToolsToolRoundtrip",
          ok: false,
          ms: realToolsRoundtripRes.ms,
          detail: realToolsRoundtripRes.ok ? (realToolsRoundtripRes.res?.detail || "failed") : realToolsRoundtripRes.error
        });
      }
    } else {
      record({ name: "realToolsSchema", ok: true, ms: 0, detail: "skipped (no captured tool_definitions yet)" });
      record({ name: "realToolsToolRoundtrip", ok: true, ms: 0, detail: "skipped (no captured tool_definitions yet)" });
    }

    // chat-stream（多模态 + 工具）
    const toolDefs = makeSelfTestToolDefinitions();
    const toolReq = makeBaseAugmentChatRequest({
      message:
        "Self-test tool call.\n1) You MUST call the tool echo_self_test with JSON arguments {\"text\":\"hello\"}.\n2) Do not output normal text; only call the tool.",
      conversationId: `byok-selftest-${randomId()}`,
      toolDefinitions: toolDefs,
      nodes: [makeImageNode()],
      chatHistory: []
    });

    const toolChatRes = await withTimed(async () => await chatStreamByProvider({ provider, model, req: toolReq, timeoutMs, abortSignal }));
    if (!toolChatRes.ok) {
      record({ name: "tools+multimodal", ok: false, ms: toolChatRes.ms, detail: toolChatRes.error });
      return entry;
    }

    const toolUses = extractToolUsesFromNodes(toolChatRes.res?.nodes);
    if (!toolUses.length) {
      record({
        name: "tools+multimodal",
        ok: true,
        ms: toolChatRes.ms,
        detail: `no tool_use observed (stop_reason=${normalizeString(toolChatRes.res?.stop_reason) || "n/a"})`
      });
      record({ name: "toolRoundtrip", ok: true, ms: 0, detail: "skipped (no tool call)" });
      log(`[${providerLabel(provider)}] done`);
      return entry;
    }

    const first = toolUses[0];
    record({
      name: "tools+multimodal",
      ok: true,
      ms: toolChatRes.ms,
      detail: `tool=${first.tool_name} id=${first.tool_use_id} stop_reason=${normalizeString(toolChatRes.res?.stop_reason) || "n/a"}`
    });

    // tool_result round-trip：把 tool_use 放入 history，再在下一轮 request_nodes 回填 tool_result
    const exchange1 = {
      request_id: "selftest_req_1",
      request_message: toolReq.message,
      response_text: "",
      request_nodes: [],
      structured_request_nodes: [],
      nodes: toolReq.nodes,
      response_nodes: Array.isArray(toolChatRes.res?.nodes) ? toolChatRes.res.nodes : [],
      structured_output_nodes: []
    };

    const toolReq2 = makeBaseAugmentChatRequest({
      message: "Tool result received. Reply with OK-tool.",
      conversationId: toolReq.conversation_id,
      toolDefinitions: toolDefs,
      nodes: [],
      chatHistory: [exchange1]
    });
    toolReq2.request_nodes = [makeToolResultNode({ toolUseId: first.tool_use_id, contentText: "{\"ok\":true}", isError: false })];

    const toolRoundtripRes = await withTimed(async () => await chatStreamByProvider({ provider, model, req: toolReq2, timeoutMs, abortSignal }));
    if (toolRoundtripRes.ok && normalizeString(toolRoundtripRes.res?.text)) {
      record({ name: "toolRoundtrip", ok: true, ms: toolRoundtripRes.ms, detail: `textLen=${String(toolRoundtripRes.res?.text || "").length}` });
    } else {
      record({ name: "toolRoundtrip", ok: false, ms: toolRoundtripRes.ms, detail: toolRoundtripRes.ok ? "empty output" : toolRoundtripRes.error });
    }

    // 提示：并非所有模型都会稳定 tool-call（尤其是 defaultModel 不是工具模型时），因此 toolRoundtrip 失败不一定代表 BYOK 协议有问题。
    if (normalizeString(toolRoundtripRes.error) && normalizeString(toolRoundtripRes.error).includes("tool_result_missing")) {
      record({ name: "note", ok: true, ms: 0, detail: "观察到 tool_result_missing：说明工具执行/回填缺失被容错降级（不是 400/422）。" });
    }

    if (toolChatRes.res?.stop_reason && toolChatRes.res.stop_reason !== STOP_REASON_TOOL_USE_REQUESTED) {
      record({ name: "note", ok: true, ms: 0, detail: `模型 stop_reason=${toolChatRes.res.stop_reason}（可能未真正进入工具模式）` });
    }

    log(`[${providerLabel(provider)}] done`);
    return entry;
  } finally {
    entry.msTotal = nowMs() - t0;
    debug(`[self-test] provider done ${providerLabel(provider)} ok=${String(entry.ok)} (${formatMs(entry.msTotal)})`);
  }
}

module.exports = { selfTestProvider };
