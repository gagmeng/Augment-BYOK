#!/usr/bin/env node
"use strict";

const path = require("path");

const { findFirstInstantiationOfExportedClass } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");

const MARKER = "__augment_byok_expose_upstream_v1";

function patchExposeUpstream(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  const { classIdent, varName, terminatorIdx } = findFirstInstantiationOfExportedClass(original, "AugmentExtension");

  const injection =
    `;try{` +
    `globalThis.__augment_byok_upstream=globalThis.__augment_byok_upstream||{};` +
    `globalThis.__augment_byok_upstream.augmentExtension=${varName};` +
    `globalThis.__augment_byok_upstream.officialChatDelegation=${varName};` +
    `globalThis.__augment_byok_upstream.capturedAtMs=Date.now();` +
    `if(${varName}&&typeof ${varName}.callApi==="function")globalThis.__augment_byok_upstream.callApiOriginal=${varName}.callApi.bind(${varName});` +
    `if(${varName}&&typeof ${varName}.callApiStream==="function")globalThis.__augment_byok_upstream.callApiStreamOriginal=${varName}.callApiStream.bind(${varName});` +
    `const __tm=(${varName}&&(${varName}._toolsModel||${varName}.toolsModel||${varName}.tools_model));` +
    `if(__tm&&typeof __tm.getToolDefinitions==="function"&&typeof __tm.callTool==="function")globalThis.__augment_byok_upstream.toolsModel=__tm;` +
    `}catch{}`;

  const next = original.slice(0, terminatorIdx + 1) + injection + original.slice(terminatorIdx + 1);
  savePatchText(filePath, next, { marker: MARKER });
  return { changed: true, reason: "patched", classIdent, varName };
}

module.exports = { patchExposeUpstream };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchExposeUpstream(filePath);
}
