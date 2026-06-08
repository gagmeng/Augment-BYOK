#!/usr/bin/env node
"use strict";

const path = require("path");

const { findExportedFactoryVar, insertBeforeSourceMappingURL } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");

const MARKER = "__augment_byok_bootstrap_injected_v1";

function patchExtensionEntry(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  const activateVar = findExportedFactoryVar(original, "activate");
  const injection =
    `\n;require("./byok/runtime/bootstrap").install({vscode:require("vscode"),getActivate:()=>${activateVar},setActivate:e=>{${activateVar}=e;if(typeof module!=="undefined"&&module.exports)module.exports.activate=e;if(typeof exports!=="undefined")exports.activate=e}})\n` +
    `;/*${MARKER}*/\n`;
  const next = insertBeforeSourceMappingURL(original, injection);
  savePatchText(filePath, next, { marker: MARKER });
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
