"use strict";

const fs = require("fs");
const path = require("path");

function resolveWebviewAssetsDir(extensionDir, callerName) {
  const caller = String(callerName || "webview-assets");
  const extDir = path.resolve(String(extensionDir || ""));
  if (!extDir || extDir === path.parse(extDir).root) throw new Error(`${caller}: invalid extensionDir`);

  const assetsDir = path.join(extDir, "common-webviews", "assets");
  if (!fs.existsSync(assetsDir)) throw new Error(`webview assets dir missing: ${assetsDir}`);
  return assetsDir;
}

function listExtensionClientContextAssets(extensionDir, callerName) {
  const assetsDir = resolveWebviewAssetsDir(extensionDir, callerName);
  const candidates = fs
    .readdirSync(assetsDir)
    .filter((name) => typeof name === "string" && name.startsWith("extension-client-context-") && name.endsWith(".js"))
    .map((name) => path.join(assetsDir, name));

  if (!candidates.length) throw new Error("extension-client-context asset not found (upstream may have changed)");
  return candidates;
}

module.exports = { listExtensionClientContextAssets, resolveWebviewAssetsDir };
