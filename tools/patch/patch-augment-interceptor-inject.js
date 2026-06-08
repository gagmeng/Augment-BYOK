#!/usr/bin/env node
"use strict";

const path = require("path");

const { readText } = require("../lib/fs");
const { assertContainsAll } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");

const MARKER = "__augment_byok_augment_interceptor_injected_v1";

function patchAugmentInterceptorInject(filePath, { injectPath }) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  const code = readText(injectPath);
  assertContainsAll(code, ["Augment Interceptor Injection Start", "Augment Interceptor Injection End"], "inject-code unexpected");

  // Bridge: the interceptor may replace module.exports with its own object.
  // Save interceptor exports to global, then restore module.exports so upstream
  // exports.xxx assignments work correctly.
  const bridge = [
    "// [BYOK] Restore module.exports after interceptor replacement",
    "if(typeof module!=='undefined'&&typeof exports!=='undefined'&&module.exports!==exports){",
    "  if(!global.__augment_interceptor_exports)global.__augment_interceptor_exports=module.exports;",
    "  module.exports=exports;",
    "}",
  ].join("\n");
  const next = `${code}\n;\n${bridge}\n;\n${original}`;
  savePatchText(filePath, next, { marker: MARKER });
  return { changed: true, reason: "patched" };
}

module.exports = { patchAugmentInterceptorInject };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  const repoRoot = path.resolve(__dirname, "../..");
  const injectPath = path.join(repoRoot, "vendor", "augment-interceptor", "inject-code.augment-interceptor.v1.2.txt");
  patchAugmentInterceptorInject(filePath, { injectPath });
}
