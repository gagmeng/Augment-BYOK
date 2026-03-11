const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { listExtensionClientContextAssets, resolveWebviewAssetsDir } = require("../tools/patch/webview-assets");

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

test("webview-assets: resolves assets dir and lists extension-client-context bundles", () => {
  withTempDir("augment-byok-webview-assets-", (dir) => {
    const extDir = path.join(dir, "extension");
    const assetsDir = path.join(extDir, "common-webviews", "assets");
    const target = path.join(assetsDir, "extension-client-context-abc.js");
    const ignored = path.join(assetsDir, "index-abc.js");
    writeUtf8(target, "console.log('ok');\n");
    writeUtf8(ignored, "console.log('ignore');\n");

    assert.equal(resolveWebviewAssetsDir(extDir, "testCaller"), assetsDir);
    assert.deepEqual(listExtensionClientContextAssets(extDir, "testCaller"), [target]);
  });
});

test("webview-assets: fails fast when target bundle is missing", () => {
  withTempDir("augment-byok-webview-assets-", (dir) => {
    const extDir = path.join(dir, "extension");
    const assetsDir = path.join(extDir, "common-webviews", "assets");
    writeUtf8(path.join(assetsDir, "index-abc.js"), "console.log('ignore');\n");

    assert.throws(
      () => listExtensionClientContextAssets(extDir, "testCaller"),
      /extension-client-context asset not found/
    );
  });
});
