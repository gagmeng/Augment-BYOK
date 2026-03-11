const test = require("node:test");
const assert = require("node:assert/strict");

function loadFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test("official-chat-delegation: audit logs emit without debug mode", async () => {
  const prev = process.env.AUGMENT_BYOK_DEBUG;
  const origLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    delete process.env.AUGMENT_BYOK_DEBUG;
    loadFresh("../payload/extension/out/byok/infra/log");
    const fresh = loadFresh("../payload/extension/out/byok/runtime/upstream/official-chat-delegation");
    await fresh.maybeBuildDelegatedAugmentChatRequest({
      endpoint: "/chat",
      body: { message: "hello", nodes: [] }
    });
    await fresh.maybeBuildDelegatedAugmentChatRequest({
      endpoint: "/chat-stream",
      body: { not_chat: true }
    });
  } finally {
    console.log = origLog;
    if (prev === undefined) delete process.env.AUGMENT_BYOK_DEBUG;
    else process.env.AUGMENT_BYOK_DEBUG = prev;
    loadFresh("../payload/extension/out/byok/infra/log");
    loadFresh("../payload/extension/out/byok/runtime/upstream/official-chat-delegation");
  }

  assert.equal(lines.some((line) => line.includes("official assembler delegated: ep=/chat source=upstream.callApiBody")), true);
  assert.equal(lines.some((line) => line.includes("official assembler delegated miss: ep=/chat-stream reason=invalid_request_body")), true);
});
