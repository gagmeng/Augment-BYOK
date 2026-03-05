const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { patchWebviewHistorySummaryNode } = require("../tools/patch/patch-webview-history-summary-node");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeUtf8(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("patchWebviewHistorySummaryNode: slims HISTORY_SUMMARY node (snake_case prop)", () => {
  withTempDir("augment-byok-webview-hs-", (dir) => {
    const extDir = path.join(dir, "extension");
    const assetsDir = path.join(extDir, "common-webviews", "assets");
    const filePath = path.join(assetsDir, "extension-client-context-test.js");

    const fixture =
      "function wK(e){const t=e.history_end.map(kK).join(\"\");return e.message_template.replace(t,e)}\n" +
      "const X={id:0,type:Ie.HISTORY_SUMMARY,history_summary_node:C};\n";
    writeUtf8(filePath, fixture);

    patchWebviewHistorySummaryNode(extDir);

    const out = readUtf8(filePath);
    assert.ok(!out.includes("type:Ie.HISTORY_SUMMARY"), "HISTORY_SUMMARY node not removed");
    assert.ok(out.includes("type:Ie.TEXT"), "TEXT node not injected");
    assert.ok(out.includes("text_node:{content:wK(C)}"), "TEXT node did not reference wK(C)");
    assert.ok(out.includes("__augment_byok_webview_history_summary_node_slim_v1"), "marker missing");
  });
});
