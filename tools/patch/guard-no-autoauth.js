#!/usr/bin/env node
"use strict";

const path = require("path");
const { readText } = require("../lib/fs");
const { assertContainsNone } = require("../lib/patch");

function guardNoAutoAuth(filePath) {
  const src = readText(filePath);
  const needles = ["case \"/autoAuth\"", "handleAutoAuth", "__augment_byok_autoauth_patched"];
  assertContainsNone(src, needles, "autoAuth guard failed");
  return { ok: true };
}

module.exports = { guardNoAutoAuth };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  guardNoAutoAuth(filePath);
}
