#!/usr/bin/env node
"use strict";

const path = require("path");

const { readText, writeText } = require("../lib/fs");
const { assertContainsAll, ensureMarker } = require("../lib/patch");

const MARKER = "__augment_byok_augment_interceptor_injected_v1";

function patchAugmentInterceptorInject(filePath, { injectPath }) {
  const original = readText(filePath);
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const code = readText(injectPath);
  assertContainsAll(code, ["Augment Interceptor Injection Start", "Augment Interceptor Injection End"], "inject-code unexpected");

  let next = `${code}\n;\n${original}`;
  next = ensureMarker(next, MARKER);
  writeText(filePath, next);
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
