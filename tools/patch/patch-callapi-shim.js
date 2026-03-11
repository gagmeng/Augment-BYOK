#!/usr/bin/env node
"use strict";

const path = require("path");

const { injectIntoAsyncMethods } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");

const MARKER = "__augment_byok_callapi_shim_patched_v1";

function patchCallApiShim(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  const callApiShimPath = "./byok/runtime/shim/call-api";
  const callApiStreamShimPath = "./byok/runtime/shim/call-api-stream";

  const sanitizeBody =
    `const __byok_body=arguments[3];` +
    `if(__byok_body&&typeof __byok_body==="object"){` +
    `try{delete __byok_body.third_party_override}catch{}` +
    `try{delete __byok_body.thirdPartyOverride}catch{}` +
    `}`;

  function makeInjection({ shimPath, exportName }) {
    return (
      `const __byok_host=this;` +
      `const __byok_ep=typeof arguments[2]==="string"?arguments[2]:"";` +
      sanitizeBody +
      `const __byok_url=typeof arguments[5]==="string"?arguments[5]:(arguments[5]&&typeof arguments[5].toString==="function"?arguments[5].toString():"");` +
      `const __byok_res=await require("${shimPath}").${exportName}({endpoint:__byok_ep,body:arguments[3],transform:arguments[4],timeoutMs:arguments[6],abortSignal:arguments[8],upstreamApiToken:(arguments[10]??((arguments[1]||{}).apiToken)),upstreamCompletionURL:__byok_url,upstreamCallHost:__byok_host});` +
      `if(__byok_res!==void 0)return __byok_res;`
    );
  }

  const apiInjection = makeInjection({ shimPath: callApiShimPath, exportName: "maybeHandleCallApi" });
  const streamInjection = makeInjection({ shimPath: callApiStreamShimPath, exportName: "maybeHandleCallApiStream" });

  let next = original;
  const apiRes = injectIntoAsyncMethods(next, "callApi", apiInjection);
  next = apiRes.out;
  const streamRes = injectIntoAsyncMethods(next, "callApiStream", streamInjection);
  next = streamRes.out;

  savePatchText(filePath, next, { marker: MARKER });
  return { changed: true, reason: "patched", callApiPatched: apiRes.count, callApiStreamPatched: streamRes.count };
}

module.exports = { patchCallApiShim };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchCallApiShim(filePath);
}
