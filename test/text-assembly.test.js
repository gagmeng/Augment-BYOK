const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveByokTextPromptContext } = require("../payload/extension/out/byok/runtime/shim/text-assembly");
const { buildNextEditStreamRuntimeContext } = require("../payload/extension/out/byok/core/next-edit/stream-utils");

test("text-assembly: delegated hit uses upstream body and skips endpoint extra system", async () => {
  const res = await resolveByokTextPromptContext({
    endpoint: "/completion",
    body: { prompt: "hello from upstream body", suffix: "SUFFIX" }
  });

  assert.equal(res.delegatedSource, "byok.endpointFields.completion");
  assert.equal(typeof res.system, "string");
  assert.ok(res.system.length > 0);
  assert.equal(Array.isArray(res.messages), true);
  assert.equal(res.messages.length, 1);
  assert.equal(res.messages[0].role, "user");
  assert.ok(res.messages[0].content.includes("hello from upstream body"));
});

test("text-assembly: delegated miss with fail_open throws (no manual fallback builder)", async () => {
  await assert.rejects(
    async () =>
      await resolveByokTextPromptContext({
        endpoint: "/completion",
        body: { not_prompt: true }
      }),
    /official text assembler delegation failed: invalid_request_body/
  );
});

test("text-assembly: unsupported endpoint throws", async () => {
  await assert.rejects(
    async () =>
      await resolveByokTextPromptContext({
        endpoint: "/unknown",
        body: { message: "hello" }
      }),
    /official text assembler delegation failed: unsupported_endpoint/
  );
});

test("text-assembly: next-edit-stream accepts blob plus selection-only context", async () => {
  const { promptBody, existingCode, selectionBegin, selectionEnd } = buildNextEditStreamRuntimeContext({
    path: "src/a.js",
    blob_name: "src/a.js",
    blobs: {
      "src/a.js": "const a = 1;\nconst b = 2;\n"
    },
    instruction: "change selected number",
    selection_begin_char: 10,
    selection_end_char: 11
  });

  assert.equal(existingCode, "1");
  assert.equal(selectionBegin, 10);
  assert.equal(selectionEnd, 11);
  assert.equal(typeof promptBody.prefix, "string");
  assert.equal(promptBody.selected_text, "1");
  assert.equal(typeof promptBody.suffix, "string");

  const res = await resolveByokTextPromptContext({
    endpoint: "/next-edit-stream",
    body: promptBody
  });

  assert.equal(res.delegatedSource, "byok.endpointFields.next-edit-stream");
  assert.equal(Array.isArray(res.messages), true);
  assert.equal(res.messages.length, 1);
  assert.ok(res.messages[0].content.includes("Selected (replace this)"));
});

test("text-assembly: removed endpoints are rejected", async () => {
  for (const endpoint of ["/edit", "/generate-conversation-title"]) {
    await assert.rejects(
      async () =>
        await resolveByokTextPromptContext({
          endpoint,
          body: {
            instruction: "insert debug call",
            path: "src/a.js",
            lang: "javascript",
            prefix: "const a = 1;\n",
            selected_text: "",
            suffix: "return a;\n",
            chat_history: [{ role: "user", content: "name this chat" }]
          }
        }),
      /official text assembler delegation failed: unsupported_endpoint/
    );
  }
});
