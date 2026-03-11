#!/usr/bin/env node
"use strict";

const path = require("path");

const { readText, writeText } = require("../lib/fs");
const { findExportedFactoryVar, insertBeforeSourceMappingURL } = require("../lib/patch");

const MARKER = "__augment_byok_bootstrap_injected_v1";

function patchExtensionEntry(filePath) {
  const original = readText(filePath);
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const activateVar = findExportedFactoryVar(original, "activate");
  const injection =
    `\n;require("./byok/runtime/bootstrap").install({vscode:require("vscode"),getActivate:()=>${activateVar},setActivate:e=>{${activateVar}=e}})\n` +
    `;/*${MARKER}*/\n`;
  const next = insertBeforeSourceMappingURL(original, injection);
  writeText(filePath, next);
  return { changed: true, reason: "patched", activateVar };
}

module.exports = { patchExtensionEntry };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchExtensionEntry(filePath);
}
