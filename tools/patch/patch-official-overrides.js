#!/usr/bin/env node
"use strict";

const path = require("path");

const { injectIntoAsyncMethods } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");

const MARKER = "__augment_byok_official_overrides_patched_v1";
const OFFICIAL_CONN_EXPR = `const __byok_off=require("./byok/config/official");const __byok_conn=__byok_off.getOfficialConnection();`;

function patchClientAuthGetters(src) {
  const apiTokenRes = injectIntoAsyncMethods(
    src,
    "getAPIToken",
    () => `try{${OFFICIAL_CONN_EXPR}if(__byok_conn.apiToken)return __byok_conn.apiToken}catch{}`
  );
  const completionURLRes = injectIntoAsyncMethods(
    apiTokenRes.out,
    "getCompletionURL",
    () => `try{${OFFICIAL_CONN_EXPR}if(__byok_conn.apiToken&&__byok_conn.completionURL)return __byok_conn.completionURL}catch{}`
  );
  return { out: completionURLRes.out, getApiTokenPatched: apiTokenRes.count, getCompletionURLPatched: completionURLRes.count };
}

function patchEndpointBasePathPreservation(src) {
  const buildInjection = ({ params }) => {
    const endpointParam = Array.isArray(params) ? params[0] : "";
    if (!endpointParam) return "";
    return `if(typeof ${endpointParam}==="string"&&${endpointParam}[0]==="/")${endpointParam}=${endpointParam}.slice(1);`;
  };

  const callRes = injectIntoAsyncMethods(src, "makeAuthenticatedCall", buildInjection);
  const streamRes = injectIntoAsyncMethods(callRes.out, "makeAuthenticatedCallStream", buildInjection);
  return { out: streamRes.out, makeAuthenticatedCallPatched: callRes.count, makeAuthenticatedCallStreamPatched: streamRes.count };
}

function patchCallApiBaseUrlAndToken(src) {
  const injection = ({ params }) => {
    if (!Array.isArray(params) || params.length < 11) return "";
    const baseUrlParam = params[5];
    const apiTokenParam = params[10];
    if (!baseUrlParam || !apiTokenParam) return "";
    return (
      `try{${OFFICIAL_CONN_EXPR}` +
      `const __byok_useOAuth=!!(this&&this.clientAuth&&this.clientAuth.auth&&this.clientAuth.auth.useOAuth);` +
      `if(__byok_conn.apiToken&&!__byok_useOAuth){if(__byok_conn.completionURL)${baseUrlParam}=__byok_conn.completionURL;${apiTokenParam}=__byok_conn.apiToken;}}catch{}` +
      `if(${baseUrlParam}==null||${baseUrlParam}==="")${baseUrlParam}=await this.clientAuth.getCompletionURL();` +
      `if(${apiTokenParam}==null||${apiTokenParam}==="")${apiTokenParam}=await this.clientAuth.getAPIToken();`
    );
  };
  return injectIntoAsyncMethods(src, "callApi", injection);
}

function patchCallApiStreamBaseUrl(src) {
  const injection = ({ params }) => {
    if (!Array.isArray(params) || params.length < 6) return "";
    const baseUrlParam = params[5];
    if (!baseUrlParam) return "";
    return (
      `try{${OFFICIAL_CONN_EXPR}` +
      `const __byok_useOAuth=!!(this&&this.clientAuth&&this.clientAuth.auth&&this.clientAuth.auth.useOAuth);` +
      `if(__byok_conn.apiToken&&__byok_conn.completionURL&&!__byok_useOAuth)${baseUrlParam}=__byok_conn.completionURL;}catch{}` +
      `if(${baseUrlParam}==null||${baseUrlParam}==="")${baseUrlParam}=await this.clientAuth.getCompletionURL();`
    );
  };
  return injectIntoAsyncMethods(src, "callApiStream", injection);
}

function patchOfficialOverrides(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  let next = original;
  const gettersRes = patchClientAuthGetters(next);
  next = gettersRes.out;
  const pathRes = patchEndpointBasePathPreservation(next);
  next = pathRes.out;

  const apiRes = patchCallApiBaseUrlAndToken(next);
  next = apiRes.out;

  const streamBaseRes = patchCallApiStreamBaseUrl(next);
  next = streamBaseRes.out;

  savePatchText(filePath, next, { marker: MARKER });
  return {
    changed: true,
    reason: "patched",
    getApiTokenPatched: gettersRes.getApiTokenPatched,
    getCompletionURLPatched: gettersRes.getCompletionURLPatched,
    makeAuthenticatedCallPatched: pathRes.makeAuthenticatedCallPatched,
    makeAuthenticatedCallStreamPatched: pathRes.makeAuthenticatedCallStreamPatched,
    callApiPatched: apiRes.count,
    callApiStreamPatched: streamBaseRes.count
  };
}

module.exports = { patchOfficialOverrides };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchOfficialOverrides(filePath);
}
