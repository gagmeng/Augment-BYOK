#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { resolveWebviewAssetsDir } = require("./webview-assets");

function sanitizeBuildId(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "build";
}

function listFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) out.push(abs);
    }
  }
  return out;
}

function patchWebviewAssetCacheBust(extensionDir, { buildId } = {}) {
  const assetsDir = resolveWebviewAssetsDir(extensionDir, "patchWebviewAssetCacheBust");
  const commonWebviewsDir = path.dirname(assetsDir);

  const safeBuildId = sanitizeBuildId(buildId);
  const assetFiles = fs
    .readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js") && !name.endsWith(".js.map"))
    .map((name) => path.join(assetsDir, name));

  const replacements = [];
  for (const filePath of assetFiles) {
    const src = fs.readFileSync(filePath, "utf8");
    if (!src.includes("__augment_byok_")) continue;

    const oldName = path.basename(filePath);
    if (oldName.includes(`-byok-${safeBuildId}.js`)) continue;
    const newName = oldName.replace(/\.js$/, `-byok-${safeBuildId}.js`);
    const newPath = path.join(assetsDir, newName);
    const oldMapName = `${oldName}.map`;
    const oldMapPath = path.join(assetsDir, oldMapName);
    const hasMap = fs.existsSync(oldMapPath);
    const newMapName = hasMap ? `${newName}.map` : "";
    const newMapPath = hasMap ? path.join(assetsDir, newMapName) : "";
    fs.renameSync(filePath, newPath);
    if (hasMap) fs.renameSync(oldMapPath, newMapPath);
    replacements.push({ oldName, newName });
    if (hasMap) replacements.push({ oldName: oldMapName, newName: newMapName });
  }

  if (!replacements.length) return { changed: false, reason: "no_marked_assets", replacements: [] };

  const textFiles = listFiles(commonWebviewsDir).filter((filePath) => /\.(html|js|css|map)$/i.test(filePath));
  for (const filePath of textFiles) {
    let text = fs.readFileSync(filePath, "utf8");
    let changed = false;
    for (const { oldName, newName } of replacements) {
      if (!text.includes(oldName)) continue;
      text = text.split(oldName).join(newName);
      changed = true;
    }
    if (changed) fs.writeFileSync(filePath, text, "utf8");
  }

  return { changed: true, reason: "patched", replacements };
}

module.exports = { patchWebviewAssetCacheBust };

if (require.main === module) {
  const extensionDir = process.argv[2];
  const buildId = process.argv[3];
  if (!extensionDir) {
    console.error(`usage: ${path.basename(process.argv[1])} <extensionDir> [buildId]`);
    process.exit(2);
  }
  patchWebviewAssetCacheBust(extensionDir, { buildId });
}
