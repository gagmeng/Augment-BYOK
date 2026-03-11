const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isObject,
  pickDelegationMeta,
  normalizeDelegationSource,
  normalizeDelegationReason,
  formatDelegationFailure,
  auditDelegationFailure
} = require("../payload/extension/out/byok/runtime/upstream/official-delegation-shared");

test("official-delegation-shared: isObject ignores arrays/null", () => {
  assert.equal(isObject({ a: 1 }), true);
  assert.equal(isObject([]), false);
  assert.equal(isObject(null), false);
});

test("official-delegation-shared: pickDelegationMeta accepts snake/camel fields", () => {
  const meta = pickDelegationMeta({
    checkpointNotFound: true,
    workspace_file_chunks: [{ path: "src/a.js", chunks: [] }]
  });

  assert.equal(meta.checkpointNotFound, true);
  assert.equal(Array.isArray(meta.workspaceFileChunks), true);
  assert.equal(meta.workspaceFileChunks.length, 1);
});

test("official-delegation-shared: normalizes source/reason and failure messages", () => {
  assert.equal(normalizeDelegationSource(" upstream.callApiBody.messages "), "upstream.callApiBody.messages");
  assert.equal(normalizeDelegationSource(""), "upstream.callApiBody");
  assert.equal(normalizeDelegationReason(" invalid_request_body "), "invalid_request_body");
  assert.equal(normalizeDelegationReason(""), "delegate_failed");
  assert.equal(formatDelegationFailure("official text assembler delegation failed", ""), "official text assembler delegation failed: delegate_failed");
});

test("official-delegation-shared: auditDelegationFailure returns normalized message", () => {
  assert.equal(auditDelegationFailure("official assembler delegation failed", " invalid_request_body "), "official assembler delegation failed: invalid_request_body");
});
