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

test("patchWebviewHistorySummaryNode: falls back to scanning all JS assets when extension-client-context bundle is renamed", () => {
  withTempDir("augment-byok-webview-hs-renamed-", (dir) => {
    const extDir = path.join(dir, "extension");
    const assetsDir = path.join(extDir, "common-webviews", "assets");
    // No extension-client-context-*.js; upstream renamed it
    const filePath = path.join(assetsDir, "renamed-bundle-AbCdEfGh.js");

    const src = [
      `function wK(e){const t=e.history_end.map(x=>x).join("");return e.message_template.replace(/x/g,()=>t)}`,
      `function GZ({summaryText:e,summarizationRequestId:t,numExchangesDroppedInBeginning:n,abridgedHistoryText:i,tail:a,messageTemplate:o,incrementalFields:r}){const s={summary_text:e,summarization_request_id:t,history_beginning_dropped_num_exchanges:n,history_middle_abridged_text:i,history_end:a,message_template:o,...r};return{id:0,type:Ze.HISTORY_SUMMARY,history_summary_node:s}}`
    ].join("\n");
    writeUtf8(filePath, src + "\n");

    const result = patchWebviewHistorySummaryNode(extDir);

    assert.equal(result.changed, true, "expected patch to apply via fallback scan");
    const out = readUtf8(filePath);
    assert.ok(!out.includes("type:Ze.HISTORY_SUMMARY,history_summary_node:s"), "HISTORY_SUMMARY node not removed");
    assert.ok(out.includes("type:Ze.TEXT"), "TEXT node not injected");
    assert.ok(out.includes("text_node:{content:wK(s)}"), "TEXT node did not reference summary formatter");
  });
});

test("patchWebviewHistorySummaryNode: returns gracefully when HISTORY_SUMMARY is absent from all assets", () => {
  withTempDir("augment-byok-webview-hs-absent-", (dir) => {
    const extDir = path.join(dir, "extension");
    const assetsDir = path.join(extDir, "common-webviews", "assets");
    // No extension-client-context-*.js and no HISTORY_SUMMARY anywhere
    writeUtf8(path.join(assetsDir, "some-other-bundle-XyZ.js"), "console.log('no history summary here');\n");

    const result = patchWebviewHistorySummaryNode(extDir);

    assert.equal(result.changed, false, "should not report change when nothing to patch");
    assert.equal(result.reason, "upstream_removed", "should report upstream_removed reason");
  });
});

test("patchWebviewHistorySummaryNode: slims HISTORY_SUMMARY node with upstream renderer alias", () => {
  withTempDir("augment-byok-webview-hs-", (dir) => {
    const extDir = path.join(dir, "extension");
    const assetsDir = path.join(extDir, "common-webviews", "assets");
    const filePath = path.join(assetsDir, "extension-client-context-test.js");

    const src = [
      `function wK(e){const t=e.history_end.map(x=>x).join("");return e.message_template.replace(/x/g,()=>t)}`,
      `function GZ({summaryText:e,summarizationRequestId:t,numExchangesDroppedInBeginning:n,abridgedHistoryText:i,tail:a,messageTemplate:o,incrementalFields:r}){const s={summary_text:e,summarization_request_id:t,history_beginning_dropped_num_exchanges:n,history_middle_abridged_text:i,history_end:a,message_template:o,...r};return{id:0,type:Ze.HISTORY_SUMMARY,history_summary_node:s}}`
    ].join("\n");
    writeUtf8(filePath, src + "\n");

    patchWebviewHistorySummaryNode(extDir);

    const out = readUtf8(filePath);
    assert.ok(!out.includes("type:Ze.HISTORY_SUMMARY,history_summary_node:s"), "HISTORY_SUMMARY node not removed");
    assert.ok(out.includes("type:Ze.TEXT"), "TEXT node not injected");
    assert.ok(out.includes("text_node:{content:wK(s)}"), "TEXT node did not reference summary formatter");
    assert.ok(out.includes("__augment_byok_webview_history_summary_node_slim_v1"), "marker missing");
  });
});
