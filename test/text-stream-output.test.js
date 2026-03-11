const test = require("node:test");
const assert = require("node:assert/strict");

const {
  coerceTextDelta,
  buildByokTextTraceLabel,
  wrapChatResultTextDeltas,
  wrapInstructionTextDeltas
} = require("../payload/extension/out/byok/runtime/shim/text-stream-output");

test("text-stream-output: coerceTextDelta normalizes stringable values", () => {
  assert.equal(coerceTextDelta("abc"), "abc");
  assert.equal(coerceTextDelta(123), "123");
  assert.equal(coerceTextDelta(null), "");
});

test("text-stream-output: buildByokTextTraceLabel keeps route/delegate context", () => {
  const label = buildByokTextTraceLabel({
    ep: "/instruction-stream",
    requestId: "rid_1",
    route: { provider: { id: "p1" }, model: "gpt-5.2" },
    delegatedSource: "upstream.callApiBody.messages",
    labelSuffix: "complete"
  });

  assert.match(label, /\[callApiStream \/instruction-stream\]/);
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

test("text-stream-output: wrapInstructionTextDeltas emits meta then replacement deltas", async () => {
  async function* deltas() {
    yield "";
    yield "x";
  }

  const out = [];
  for await (const item of wrapInstructionTextDeltas(deltas(), { meta: { replacement_start_line: 1 } })) out.push(item);

  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { text: "", replacement_start_line: 1 });
  assert.deepEqual(out[1], { text: "x", replacement_text: "x" });
});
