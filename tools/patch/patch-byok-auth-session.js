#!/usr/bin/env node
"use strict";

const path = require("path");

const { injectIntoAsyncMethods, ensureMarker } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");

const MARKER = "__augment_byok_auth_session_patched_v1";

function patchByokAuthSession(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  let next = original;

  const getSessionRes = injectIntoAsyncMethods(next, "getSession", () => {
    return (
      `try{` +
      `const __byok_auth=require("./byok/runtime/auth-session");` +
      `const __byok_session=__byok_auth.getByokOfficialSession();` +
      `if(__byok_session)return __byok_session;` +
      `}catch{}`
    );
  });
  next = getSessionRes.out;

  const initStateRes = injectIntoAsyncMethods(next, "initState", () => {
    return (
      `try{` +
      `const __byok_auth=require("./byok/runtime/auth-session");` +
      `__byok_auth.syncByokAuthState({store:this,commands:Vx.commands});` +
      `}catch{}`
    );
  });
  next = initStateRes.out;

  next = ensureMarker(next, MARKER);
  savePatchText(filePath, next, { marker: MARKER });
  return {
    changed: true,
    reason: "patched",
    getSessionPatched: getSessionRes.count,
    initStatePatched: initStateRes.count
  };
}

module.exports = { patchByokAuthSession };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchByokAuthSession(filePath);
}
