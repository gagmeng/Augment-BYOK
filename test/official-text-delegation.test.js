const test = require("node:test");
const assert = require("node:assert/strict");

function loadFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

const { maybeBuildDelegatedTextPrompt } = require("../payload/extension/out/byok/runtime/upstream/official-text-delegation");

test("official-text-delegation: builds from endpoint fields for completion", async () => {
  const res = await maybeBuildDelegatedTextPrompt({
    endpoint: "/completion",
    body: { prompt: "hello completion", suffix: "SUFFIX" }
  });

  assert.equal(res.ok, true);
  assert.equal(res.source, "byok.endpointFields.completion");
  assert.equal(typeof res.system, "string");
  assert.ok(res.system.length > 0);
  assert.equal(Array.isArray(res.messages), true);
  assert.equal(res.messages.length, 1);
  assert.equal(res.messages[0].role, "user");
  assert.ok(res.messages[0].content.includes("hello completion"));
});

test("official-text-delegation: builds from messages[] and keeps system as system text", async () => {
  const res = await maybeBuildDelegatedTextPrompt({
    endpoint: "/instruction-stream",
    body: {
      messages: [
        { role: "system", content: "SYSTEM_RULES" },
        { role: "user", content: "DO_IT" }
      ]
    }
  });

  assert.equal(res.ok, true);
  assert.equal(res.source, "upstream.callApiBody.messages");
  assert.equal(res.system, "SYSTEM_RULES");
  assert.deepEqual(res.messages, [{ role: "user", content: "DO_IT" }]);
});

test("official-text-delegation: chat endpoint is rejected (chat delegation handled elsewhere)", async () => {
  const res = await maybeBuildDelegatedTextPrompt({
    endpoint: "/chat",
    body: { message: "hello" }
  });

  assert.equal(res.ok, false);
  assert.equal(res.reason, "chat_endpoint_use_chat_delegation");
});

test("official-text-delegation: unsupported endpoint returns miss", async () => {
  for (const endpoint of ["/unknown", "/edit", "/generate-conversation-title"]) {
    const res = await maybeBuildDelegatedTextPrompt({
      endpoint,
      body: { message: "hello" }
    });

    assert.equal(res.ok, false);
    assert.equal(res.reason, "unsupported_endpoint");
  }
});

test("official-text-delegation: invalid non-chat body returns miss", async () => {
  const res = await maybeBuildDelegatedTextPrompt({
    endpoint: "/completion",
    body: { not_prompt: true }
  });

  assert.equal(res.ok, false);
  assert.equal(res.reason, "invalid_request_body");
});

test("official-text-delegation: audit logs emit without debug mode", async () => {
  const prev = process.env.AUGMENT_BYOK_DEBUG;
  const origLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    delete process.env.AUGMENT_BYOK_DEBUG;
    loadFresh("../payload/extension/out/byok/infra/log");
    const fresh = loadFresh("../payload/extension/out/byok/runtime/upstream/official-text-delegation");
    await fresh.maybeBuildDelegatedTextPrompt({
      endpoint: "/completion",
      body: { prompt: "hello completion" }
    });
    await fresh.maybeBuildDelegatedTextPrompt({
      endpoint: "/completion",
      body: { not_prompt: true }
    });
  } finally {
    console.log = origLog;
    if (prev === undefined) delete process.env.AUGMENT_BYOK_DEBUG;
    else process.env.AUGMENT_BYOK_DEBUG = prev;
    loadFresh("../payload/extension/out/byok/infra/log");
    loadFresh("../payload/extension/out/byok/runtime/upstream/official-text-delegation");
  }

  assert.equal(lines.some((line) => line.includes("official text assembler delegated: ep=/completion source=")), true);
  assert.equal(lines.some((line) => line.includes("official text assembler delegated miss: ep=/completion reason=invalid_request_body")), true);
});
