const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isOfficialDelegationEndpoint,
  isOfficialExecutionDelegationEndpoint
} = require("../payload/extension/out/byok/core/official-delegation");

test("official-delegation-core: endpoint matcher only accepts chat/chat-stream", () => {
  assert.equal(isOfficialDelegationEndpoint("/chat"), true);
  assert.equal(isOfficialDelegationEndpoint("/chat-stream"), true);
  assert.equal(isOfficialDelegationEndpoint("/completion"), false);
});

test("official-delegation-core: execution delegation endpoint matcher accepts non-chat endpoints", () => {
  assert.equal(isOfficialExecutionDelegationEndpoint("/chat"), true);
  assert.equal(isOfficialExecutionDelegationEndpoint("/completion"), true);
  assert.equal(isOfficialExecutionDelegationEndpoint("/instruction-stream"), true);
  assert.equal(isOfficialExecutionDelegationEndpoint("/unknown"), false);
});
