const test = require("node:test");
const assert = require("node:assert/strict");

const prevUpstream = globalThis.__augment_byok_upstream;

const {
  maybeBuildDelegatedAugmentChatRequest,
  __resetOfficialChatDelegationApiCacheForTest
} = require("../payload/extension/out/byok/runtime/upstream/official-chat-delegation");

test.after(() => {
  if (prevUpstream === undefined) delete globalThis.__augment_byok_upstream;
  else globalThis.__augment_byok_upstream = prevUpstream;
});

test.beforeEach(() => {
  if (typeof __resetOfficialChatDelegationApiCacheForTest === "function") __resetOfficialChatDelegationApiCacheForTest();
});

test("official-chat-delegation: uses upstream callApi body as single source of truth", async () => {
  const res = await maybeBuildDelegatedAugmentChatRequest({
    endpoint: "/chat",
    body: { message: "hello", nodes: [] },
    requestId: "rid_1",
    timeoutMs: 1000
  });

  assert.equal(res.ok, true);
  assert.equal(typeof res.req, "object");
  assert.equal(res.req.message, "hello");
  assert.equal(res.source, "upstream.callApiBody");
});

test("official-chat-delegation: unsupported endpoint returns miss", async () => {
  const res = await maybeBuildDelegatedAugmentChatRequest({
    endpoint: "/completion",
    body: {},
    requestId: "rid_2",
    timeoutMs: 1000
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "unsupported_endpoint");
});

test("official-chat-delegation: invalid request body returns miss", async () => {
  const res = await maybeBuildDelegatedAugmentChatRequest({
    endpoint: "/chat-stream",
    body: { not_chat: true },
    requestId: "rid_3",
    timeoutMs: 1000
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "invalid_request_body");
});

test("official-chat-delegation: carries checkpoint/workspace meta from call body", async () => {
  const res = await maybeBuildDelegatedAugmentChatRequest({
    endpoint: "/chat-stream",
    body: {
      message: "x",
      checkpoint_not_found: true,
      workspace_file_chunks: [{ path: "src/a.js", chunks: [] }]
    },
    requestId: "rid_4",
    timeoutMs: 1000
  });

  assert.equal(res.ok, true);
  assert.equal(res.meta.checkpointNotFound, true);
  assert.equal(Array.isArray(res.meta.workspaceFileChunks), true);
  assert.equal(res.meta.workspaceFileChunks.length, 1);
  assert.equal(res.meta.workspaceFileChunks[0].path, "src/a.js");
});

test("official-chat-delegation: no longer depends on upstream private method names", async () => {
  globalThis.__augment_byok_upstream = {
    augmentExtension: {
      async buildDelegatedAugmentChatRequest() {
        return {
          req: { message: "private-method-result", nodes: [] }
        };
      }
    }
  };

  const res = await maybeBuildDelegatedAugmentChatRequest({
    endpoint: "/chat",
    body: { message: "body-source", nodes: [] },
    requestId: "rid_5",
    timeoutMs: 1000
  });

  assert.equal(res.ok, true);
  assert.equal(res.req.message, "body-source");
  assert.equal(res.source, "upstream.callApiBody");
});
