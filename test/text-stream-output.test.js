const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildByokTextTraceLabel,
  wrapChatResultTextDeltas
} = require("../payload/extension/out/byok/runtime/shim/text-stream-output");

test("text-stream-output: buildByokTextTraceLabel keeps route/delegate context", () => {
  const label = buildByokTextTraceLabel({
    ep: "/prompt-enhancer",
    requestId: "rid_1",
    route: { provider: { id: "p1" }, model: "gpt-5.2" },
    delegatedSource: "upstream.callApiBody.messages",
    labelSuffix: "complete"
  });

  assert.match(label, /\[callApiStream \/prompt-enhancer\]/);
  assert.match(label, /rid=rid_1/);
  assert.match(label, /complete/);
  assert.match(label, /model=gpt-5.2/);
  assert.match(label, /delegate=upstream\.callApiBody\.messages/);
});

test("text-stream-output: wrapChatResultTextDeltas emits chat_result envelope", async () => {
  async function* deltas() {
    yield "a";
    yield "b";
  }

  const out = [];
  for await (const chunk of wrapChatResultTextDeltas(deltas())) out.push(chunk);

  assert.equal(out.length, 2);
  assert.equal(out[0].text, "a");
  assert.equal(Array.isArray(out[0].nodes), true);
  assert.equal(out[1].text, "b");
});
