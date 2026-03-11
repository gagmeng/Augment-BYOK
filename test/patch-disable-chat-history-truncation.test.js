const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { patchDisableChatHistoryTruncation } = require("../tools/patch/patch-disable-chat-history-truncation");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeUtf8(filePath, content) {
  fs.writeFileSync(filePath, content, "utf8");
}

test("patchDisableChatHistoryTruncation: wraps field assignment and is idempotent", () => {
  withTempDir("augment-byok-trunc-field-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    writeUtf8(filePath, 'class A{constructor(){this.limitChatHistory=(x=>x.slice(0,1));}}');

    const r1 = patchDisableChatHistoryTruncation(filePath);
    assert.equal(r1.changed, true);
    assert.equal(r1.patchedFieldAssignments, 1);

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_disable_chat_history_truncation_v1"));
    assert.ok(out1.includes('return arguments[0];'));
    assert.ok(out1.includes("__byok_prev.apply(this,arguments)"));

    const r2 = patchDisableChatHistoryTruncation(filePath);
    assert.equal(r2.changed, false);
    assert.equal(readUtf8(filePath), out1);
  });
});

test("patchDisableChatHistoryTruncation: injects method guard and is idempotent", () => {
  withTempDir("augment-byok-trunc-method-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    writeUtf8(filePath, 'class A{limitChatHistory(a,b){return b.slice(-2)}}');

    const r1 = patchDisableChatHistoryTruncation(filePath);
    assert.equal(r1.changed, true);
    assert.equal(r1.patchedMethodDefinitions, 1);

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_disable_chat_history_truncation_v1"));
    assert.ok(out1.includes('const __byok_state=require("./byok/config/state");'));
    assert.ok(out1.includes('return arguments[0];'));

    const r2 = patchDisableChatHistoryTruncation(filePath);
    assert.equal(r2.changed, false);
    assert.equal(readUtf8(filePath), out1);
  });
});
