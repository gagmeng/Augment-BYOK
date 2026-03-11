const test = require("node:test");
const assert = require("node:assert/strict");

const { buildByokAugmentChatContext } = require("../payload/extension/out/byok/runtime/shim/augment-chat");

const prevUpstream = globalThis.__augment_byok_upstream;
test.after(() => {
  if (prevUpstream === undefined) delete globalThis.__augment_byok_upstream;
  else globalThis.__augment_byok_upstream = prevUpstream;
});

function makeProvider({ type, requestDefaults }) {
  return {
    id: "p1",
    type,
    baseUrl: "https://example.invalid",
    apiKey: "",
    headers: { authorization: "Bearer test" },
    requestDefaults: requestDefaults && typeof requestDefaults === "object" ? requestDefaults : {}
  };
}

async function buildCtx({ provider, kind, cfg, body, route } = {}) {
  const k = kind === "chat" ? "chat" : "chat-stream";
  const ep = k === "chat" ? "/chat" : "/chat-stream";
  return await buildByokAugmentChatContext({
    kind: k,
    endpoint: ep,
    cfg: cfg && typeof cfg === "object" ? cfg : {},
    provider,
    model: "gpt-5.3-codex",
    requestedModel: "gpt-5.3-codex",
    body: body && typeof body === "object" ? body : { message: "hi" },
    timeoutMs: 1,
    abortSignal: null,
    upstreamCompletionURL: "",
    upstreamApiToken: "",
    requestId: "r1",
    route
  });
}

test("buildByokAugmentChatContext: injects auto max_output_tokens when requestDefaults missing", async () => {
  const ctx = await buildCtx({ provider: makeProvider({ type: "openai_compatible", requestDefaults: {} }), kind: "chat-stream" });
  assert.equal(ctx.requestDefaults.max_output_tokens, 65536);
});

test("buildByokAugmentChatContext: does not override explicit max_tokens", async () => {
  const ctx = await buildCtx({ provider: makeProvider({ type: "openai_compatible", requestDefaults: { max_tokens: 123 } }), kind: "chat" });
  assert.equal(ctx.requestDefaults.max_tokens, 123);
  assert.equal(ctx.requestDefaults.max_output_tokens, undefined);
});

test("buildByokAugmentChatContext: does not override explicit max_output_tokens", async () => {
  const ctx = await buildCtx({ provider: makeProvider({ type: "openai_responses", requestDefaults: { max_output_tokens: 321 } }), kind: "chat-stream" });
  assert.equal(ctx.requestDefaults.max_output_tokens, 321);
});

test("buildByokAugmentChatContext: respects gemini generationConfig.maxOutputTokens", async () => {
  const ctx = await buildCtx({
    provider: makeProvider({ type: "gemini_ai_studio", requestDefaults: { generationConfig: { maxOutputTokens: 99 } } }),
    kind: "chat-stream"
  });
  assert.deepEqual(ctx.requestDefaults.generationConfig, { maxOutputTokens: 99 });
  assert.equal(ctx.requestDefaults.max_output_tokens, undefined);
});

test("buildByokAugmentChatContext: auto max_output_tokens accounts for multibyte (CJK) prompts", async () => {
  const provider = makeProvider({ type: "openai_compatible", requestDefaults: {} });
  const big = "你".repeat(500000);

  const ctx = await buildByokAugmentChatContext({
    kind: "chat-stream",
    endpoint: "/chat-stream",
    cfg: {},
    provider,
    model: "gpt-5.3-codex",
    requestedModel: "gpt-5.3-codex",
    body: { message: big },
    timeoutMs: 1,
    abortSignal: null,
    upstreamCompletionURL: "",
    upstreamApiToken: "",
    requestId: "r_big_cjk"
  });

  assert.ok(Number.isFinite(Number(ctx.requestDefaults.max_output_tokens)));
  assert.ok(ctx.requestDefaults.max_output_tokens < 65536);
  assert.ok(ctx.requestDefaults.max_output_tokens >= 256);
});

test("buildByokAugmentChatContext: delegated assembler meta maps to checkpoint/workspace fields", async () => {
  const ctx = await buildByokAugmentChatContext({
    kind: "chat",
    endpoint: "/chat",
    cfg: {},
    provider: makeProvider({ type: "openai_compatible", requestDefaults: {} }),
    model: "gpt-5.3-codex",
    requestedModel: "gpt-5.3-codex",
    body: {
      message: "raw",
      checkpoint_not_found: true,
      workspace_file_chunks: [{ path: "src/a.js", chunks: [] }]
    },
    timeoutMs: 1000,
    abortSignal: null,
    upstreamCompletionURL: "",
    upstreamApiToken: "",
    requestId: "r_delegate_meta"
  });

  assert.equal(ctx.req.message, "raw");
  assert.equal(ctx.checkpointNotFound, true);
  assert.equal(Array.isArray(ctx.workspaceFileChunks), true);
  assert.equal(ctx.workspaceFileChunks.length, 1);
  assert.equal(ctx.workspaceFileChunks[0].path, "src/a.js");
  assert.equal(ctx.responseMeta.checkpointNotFound, true);
  assert.equal(ctx.responseMeta.workspaceFileChunks.length, 1);
});

test("buildByokAugmentChatContext: delegated assembler hit keeps official body and skips endpoint extra system prompt", async () => {
  const ctx = await buildCtx({
    kind: "chat-stream",
    provider: makeProvider({ type: "openai_compatible", requestDefaults: {} }),
    cfg: {
      prompts: {
        endpointSystem: {
          "/chat-stream": "BYOK_EXTRA_SYSTEM_SHOULD_NOT_APPLY_ON_DELEGATED_HIT"
        }
      }
    },
    body: { message: "delegated-msg" }
  });

  assert.equal(ctx.req.message, "delegated-msg");
  assert.equal(Object.prototype.hasOwnProperty.call(ctx.req, "byok_system_prompt"), false);
});

test("buildByokAugmentChatContext: invalid chat body throws (official assembler required)", async () => {
  await assert.rejects(
    async () =>
      await buildCtx({
        kind: "chat-stream",
        provider: makeProvider({ type: "openai_compatible", requestDefaults: {} }),
        cfg: {},
        body: { not_chat: true }
      }),
    /official assembler delegation failed: invalid_request_body/
  );
});
