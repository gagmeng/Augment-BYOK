const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { patchWebviewAssetCacheBust } = require("../tools/patch/patch-webview-asset-cache-bust");

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

test("patchWebviewAssetCacheBust: renames marked asset and rewrites html/js references", () => {
  withTempDir("augment-byok-webview-cache-bust-", (dir) => {
    const extDir = path.join(dir, "extension");
    const webviewsDir = path.join(extDir, "common-webviews");
    const assetsDir = path.join(webviewsDir, "assets");
    const targetJs = path.join(assetsDir, "extension-client-context-abc123.js");
    const targetMap = path.join(assetsDir, "extension-client-context-abc123.js.map");
    const importerJs = path.join(assetsDir, "shared-state.js");
    const html = path.join(webviewsDir, "main-panel.html");

    writeUtf8(
      targetJs,
      'console.log("patched");\n;/*__augment_byok_webview_history_summary_node_slim_v1*/\n//# sourceMappingURL=extension-client-context-abc123.js.map\n'
    );
    writeUtf8(targetMap, '{"version":3,"file":"extension-client-context-abc123.js"}\n');
    writeUtf8(importerJs, 'import "./extension-client-context-abc123.js";\n');
    writeUtf8(html, '<link rel="modulepreload" href="./assets/extension-client-context-abc123.js">\n');

    const res = patchWebviewAssetCacheBust(extDir, { buildId: "Test Build" });

    assert.equal(res.changed, true);
    assert.deepEqual(res.replacements, [
      {
        oldName: "extension-client-context-abc123.js",
        newName: "extension-client-context-abc123-byok-test-build.js"
      },
      {
        oldName: "extension-client-context-abc123.js.map",
        newName: "extension-client-context-abc123-byok-test-build.js.map"
      }
    ]);
    assert.equal(fs.existsSync(targetJs), false);
    assert.equal(fs.existsSync(targetMap), false);
    assert.equal(fs.existsSync(path.join(assetsDir, "extension-client-context-abc123-byok-test-build.js")), true);
    assert.equal(fs.existsSync(path.join(assetsDir, "extension-client-context-abc123-byok-test-build.js.map")), true);
    assert.equal(readUtf8(importerJs).includes("extension-client-context-abc123-byok-test-build.js"), true);
    assert.equal(readUtf8(html).includes("extension-client-context-abc123-byok-test-build.js"), true);
  });
});
