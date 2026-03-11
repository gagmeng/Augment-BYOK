const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeChatResponseMeta,
  mergeChatResponseMeta,
  applyChatResponseMeta,
  injectChatResponseMetaStream
} = require("../payload/extension/out/byok/core/chat-response-meta");
const { makeBackChatResult } = require("../payload/extension/out/byok/core/protocol");
const { STOP_REASON_END_TURN, makeBackChatChunk } = require("../payload/extension/out/byok/core/augment-protocol");

test("chat-response-meta: merge prefers any checkpoint hit and first non-empty workspace chunks", () => {
  const meta = mergeChatResponseMeta(
    { checkpointNotFound: false, workspaceFileChunks: [] },
    { checkpointNotFound: true, workspaceFileChunks: [{ path: "src/a.js", chunks: [] }] },
    { checkpointNotFound: false, workspaceFileChunks: [{ path: "src/b.js", chunks: [] }] }
  );

  assert.equal(meta.checkpointNotFound, true);
  assert.equal(meta.workspaceFileChunks.length, 1);
  assert.equal(meta.workspaceFileChunks[0].path, "src/a.js");
});

test("chat-response-meta: makeBackChatResult/makeBackChatChunk apply normalized meta", () => {
  const meta = normalizeChatResponseMeta({
    checkpointNotFound: true,
    workspaceFileChunks: [{ path: "src/a.js", chunks: [] }]
  });

  const result = makeBackChatResult("ok", { nodes: [], meta });
  const chunk = makeBackChatChunk({ text: "", stop_reason: STOP_REASON_END_TURN, meta });

  assert.equal(result.checkpoint_not_found, true);
  assert.equal(result.workspace_file_chunks.length, 1);
  assert.equal(chunk.checkpoint_not_found, true);
  assert.equal(chunk.workspace_file_chunks.length, 1);
});

test("chat-response-meta: injectChatResponseMetaStream keeps checkpoint on every chunk but workspace only once", async () => {
  async function* src() {
    yield makeBackChatChunk({ text: "a", nodes: [] });
    yield makeBackChatChunk({ text: "b", nodes: [] });
  }

  const out = [];
  for await (const chunk of injectChatResponseMetaStream(src(), {
    checkpointNotFound: true,
    workspaceFileChunks: [{ path: "src/a.js", chunks: [] }]
  })) {
    out.push(chunk);
  }

  assert.equal(out.length, 2);
  assert.equal(out[0].checkpoint_not_found, true);
  assert.equal(out[1].checkpoint_not_found, true);
  assert.equal(Array.isArray(out[0].workspace_file_chunks), true);
  assert.equal(out[0].workspace_file_chunks.length, 1);
  assert.equal(Array.isArray(out[1].workspace_file_chunks), true);
  assert.equal(out[1].workspace_file_chunks.length, 0);
});
