#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { ensureMarker } = require("../lib/patch");

const MARKER = "__augment_byok_official_overrides_patched_v1";

function parseParamNames(paramsRaw) {
  const raw = String(paramsRaw || "");
  return raw
    .split(",")
    .map((x) => x.split("=")[0].trim())
    .filter(Boolean);
}

function injectIntoAsyncMethods(src, methodName, buildInjection) {
  const re = new RegExp(`async\\s+${methodName}\\s*\\(([^)]*)\\)`, "g");
  const matches = Array.from(src.matchAll(re));
  if (!matches.length) throw new Error(`${methodName} needle not found (upstream may have changed)`);

  let out = src;
  let patched = 0;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const idx = m.index;
    const openBrace = out.indexOf("{", idx);
    if (openBrace < 0) throw new Error(`${methodName} patch: failed to locate method body opening brace`);
    const params = parseParamNames(m[1] || "");
    const injection = String(buildInjection(params) || "");
    if (!injection) continue;
    out = out.slice(0, openBrace + 1) + injection + out.slice(openBrace + 1);
    patched += 1;
  }
  return { out, count: patched };
}

function injectOnceAfterLiteral(src, needle, injection, label) {
  const idx = src.indexOf(needle);
  if (idx < 0) throw new Error(`needle not found: ${label}`);
  const idx2 = src.indexOf(needle, idx + needle.length);
  if (idx2 >= 0) throw new Error(`needle not unique: ${label}`);
  return src.slice(0, idx + needle.length) + injection + src.slice(idx + needle.length);
}

function patchClientAuthGetters(src) {
  const injectApiToken =
    `try{const __byok_off=require("./byok/config/official").getOfficialConnection();if(__byok_off.apiToken)return __byok_off.apiToken}catch{}` +
    ``;
  const injectCompletionURL =
    `try{const __byok_off=require("./byok/config/official").getOfficialConnection();if(__byok_off.apiToken&&__byok_off.completionURL)return __byok_off.completionURL}catch{}` +
    ``;

  let out = src;
  out = injectOnceAfterLiteral(out, "async getAPIToken(){", injectApiToken, "clientAuth.getAPIToken");
  out = injectOnceAfterLiteral(out, "async getCompletionURL(){", injectCompletionURL, "clientAuth.getCompletionURL");
  out = patchClientAuthSettingsFallback(out);
  return out;
}

function replaceAllOrThrow(src, re, replacement, label) {
  const matches = Array.from(src.matchAll(re));
  if (!matches.length) throw new Error(`patch failed: ${label} (matched=0)`);
  return { out: src.replace(re, replacement), count: matches.length };
}

function patchClientAuthSettingsFallback(src) {
  let out = src;
  const tokenRes = replaceAllOrThrow(out, /return this\.configListener\.config\.apiToken/g, `return ""`, "clientAuth apiToken settings fallback");
  out = tokenRes.out;
  const urlRes = replaceAllOrThrow(
    out,
    /return this\.configListener\.config\.completionURL/g,
    `return require("./byok/config/official").DEFAULT_OFFICIAL_COMPLETION_URL`,
    "clientAuth completionURL settings fallback"
  );
  out = urlRes.out;
  return out;
}

function patchConfigListenerNormalizeConfig(src) {
  const re =
    /apiToken:\(t\?\.\s*advanced\?\.\s*apiToken\?\?t\.apiToken\?\?"\"\)\.trim\(\)\.toUpperCase\(\),completionURL:\(t\?\.\s*advanced\?\.\s*completionURL\?\?t\.completionURL\?\?"\"\)\.trim\(\)/g;

  const replacement =
    `apiToken:(()=>{try{const __byok_conn=require("./byok/config/official").getOfficialConnection();return (__byok_conn.apiToken||"").trim()}catch{return""}})(),` +
    `completionURL:(()=>{try{const __byok_off=require("./byok/config/official");const __byok_conn=__byok_off.getOfficialConnection();const __byok_tok=(__byok_conn.apiToken||"").trim();return __byok_tok?(__byok_conn.completionURL||__byok_off.DEFAULT_OFFICIAL_COMPLETION_URL||"https://api.augmentcode.com/").trim():""}catch{return""}})()`;

  const res = replaceAllOrThrow(src, re, replacement, "configListener normalizeConfig ignore settings apiToken/completionURL");
  if (res.count !== 1) throw new Error(`patch failed: normalizeConfig match count unexpected (${res.count})`);
  return res.out;
}

function patchAuthenticatedCallUrlJoin(src) {
  let out = src;

  const repl = `new URL((typeof t==="string"&&t[0]==="/")?t.slice(1):t,`;

  const res1 = replaceAllOrThrow(out, /new URL\(t,c\)/g, `${repl}c)`, "makeAuthenticatedCall preserve base path");
  if (res1.count !== 1) throw new Error(`patch failed: makeAuthenticatedCall match count unexpected (${res1.count})`);
  out = res1.out;

  const res2 = replaceAllOrThrow(out, /new URL\(t,c\.tenantUrl\)/g, `${repl}c.tenantUrl)`, "makeAuthenticatedCallStream preserve base path");
  if (res2.count !== 1) throw new Error(`patch failed: makeAuthenticatedCallStream match count unexpected (${res2.count})`);
  out = res2.out;

  return out;
}

function patchAuthenticatedCallDisabledEndpoints(src) {
  let out = src;

  const unaryInjection =
    `try{` +
    `const __byok_state=require("./byok/config/state");` +
    `const __byok_cfg=__byok_state.ensureConfigManager().get();` +
    `const __byok_rules=__byok_cfg&&__byok_cfg.routing&&__byok_cfg.routing.rules;` +
    `const __byok_ep=typeof t==="string"?t:"";` +
    `const __byok_norm=__byok_ep&&__byok_ep[0]==="/" ? __byok_ep : "/"+__byok_ep;` +
    `const __byok_r=__byok_rules&&__byok_rules[__byok_norm];` +
    `if(__byok_r&&__byok_r.mode==="disabled")return {};` +
    `}catch{}` +
    ``;

  out = injectOnceAfterLiteral(out, `async makeAuthenticatedCall(t,r,n,i="POST",o,s){`, unaryInjection, "makeAuthenticatedCall disabled endpoints");

  const streamInjection =
    `try{` +
    `const __byok_state=require("./byok/config/state");` +
    `const __byok_cfg=__byok_state.ensureConfigManager().get();` +
    `const __byok_rules=__byok_cfg&&__byok_cfg.routing&&__byok_cfg.routing.rules;` +
    `const __byok_ep=typeof t==="string"?t:"";` +
    `const __byok_norm=__byok_ep&&__byok_ep[0]==="/" ? __byok_ep : "/"+__byok_ep;` +
    `const __byok_r=__byok_rules&&__byok_rules[__byok_norm];` +
    `if(__byok_r&&__byok_r.mode==="disabled")return(async function*(){})();` +
    `}catch{}` +
    ``;

  out = injectOnceAfterLiteral(out, `async makeAuthenticatedCallStream(t,r,n,i="post",o){`, streamInjection, "makeAuthenticatedCallStream disabled endpoints");

  return out;
}

function patchAuthenticatedCallErrorMessages(src) {
  let out = src;

  const res = replaceAllOrThrow(
    out,
    /throw new ([A-Za-z_$][0-9A-Za-z_$]*)\(`API call failed: \$\{([A-Za-z_$][0-9A-Za-z_$]*)\.statusText\}`,Ye\.Internal\)/g,
    "throw new $1(`API call failed: ${$2.status} ${$2.statusText} (${u.toString()})`,Ye.Internal)",
    "makeAuthenticatedCall error message include url"
  );
  // expected: 3 (unary f + stream h + stream f)
  if (res.count !== 3) throw new Error(`patch failed: makeAuthenticatedCall error message match count unexpected (${res.count})`);
  out = res.out;

  return out;
}

function patchCallApiBaseUrlAndToken(src) {
  const injection = (params) => {
    if (!Array.isArray(params) || params.length < 11) return "";
    const baseUrlParam = params[5];
    const apiTokenParam = params[10];
    if (!baseUrlParam || !apiTokenParam) return "";
    return (
      `try{const __byok_off=require("./byok/config/official");const __byok_conn=__byok_off.getOfficialConnection();` +
      `const __byok_useOAuth=!!(this&&this.clientAuth&&this.clientAuth.auth&&this.clientAuth.auth.useOAuth);` +
      `if(__byok_conn.apiToken&&!__byok_useOAuth){if(__byok_conn.completionURL)${baseUrlParam}=__byok_conn.completionURL;${apiTokenParam}=__byok_conn.apiToken;}` +
      `const __byok_base=typeof ${baseUrlParam}==="string"?${baseUrlParam}:(${baseUrlParam}&&typeof ${baseUrlParam}.toString==="function"?${baseUrlParam}.toString():"");` +
      `if(__byok_base&&(__byok_base.includes("127.0.0.1")||__byok_base.includes("0.0.0.0")||__byok_base.includes("localhost")||__byok_base.includes("[::1]")))${baseUrlParam}=__byok_off.DEFAULT_OFFICIAL_COMPLETION_URL}catch{}` +
      `if(!${baseUrlParam})${baseUrlParam}=await this.clientAuth.getCompletionURL();` +
      `if(!${apiTokenParam})${apiTokenParam}=await this.clientAuth.getAPIToken();` +
      ``
    );
  };
  return injectIntoAsyncMethods(src, "callApi", injection);
}

function patchCallApiStreamBaseUrl(src) {
  const injection = (params) => {
    if (!Array.isArray(params) || params.length < 6) return "";
    const baseUrlParam = params[5];
    if (!baseUrlParam) return "";
    return (
      `try{const __byok_off=require("./byok/config/official");const __byok_conn=__byok_off.getOfficialConnection();` +
      `const __byok_useOAuth=!!(this&&this.clientAuth&&this.clientAuth.auth&&this.clientAuth.auth.useOAuth);` +
      `if(__byok_conn.apiToken&&__byok_conn.completionURL&&!__byok_useOAuth)${baseUrlParam}=__byok_conn.completionURL;` +
      `const __byok_base=typeof ${baseUrlParam}==="string"?${baseUrlParam}:(${baseUrlParam}&&typeof ${baseUrlParam}.toString==="function"?${baseUrlParam}.toString():"");` +
      `if(__byok_base&&(__byok_base.includes("127.0.0.1")||__byok_base.includes("0.0.0.0")||__byok_base.includes("localhost")||__byok_base.includes("[::1]")))${baseUrlParam}=__byok_off.DEFAULT_OFFICIAL_COMPLETION_URL}catch{}`
    );
  };
  return injectIntoAsyncMethods(src, "callApiStream", injection);
}

function patchCallApiStreamCompletionUrlCoalesce(src) {
  const re = /(\b[a-zA-Z_$][\w$]*)=\1\?\?await this\.clientAuth\.getCompletionURL\(\)/g;
  let count = 0;
  const out = src.replace(re, (_m, v) => {
    count += 1;
    return `${v}=${v}||await this.clientAuth.getCompletionURL()`;
  });
  return { out, count };
}

function patchOfficialOverrides(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  let next = original;
  next = patchClientAuthGetters(next);
  next = patchConfigListenerNormalizeConfig(next);
  next = patchAuthenticatedCallUrlJoin(next);
  next = patchAuthenticatedCallDisabledEndpoints(next);
  next = patchAuthenticatedCallErrorMessages(next);

  const apiRes = patchCallApiBaseUrlAndToken(next);
  next = apiRes.out;

  const streamBaseRes = patchCallApiStreamBaseUrl(next);
  next = streamBaseRes.out;

  const streamRes = patchCallApiStreamCompletionUrlCoalesce(next);
  next = streamRes.out;

  next = ensureMarker(next, MARKER);
  fs.writeFileSync(filePath, next, "utf8");
  return {
    changed: true,
    reason: "patched",
    callApiPatched: apiRes.count,
    callApiStreamPatched: streamBaseRes.count,
    callApiStreamCoalescePatched: streamRes.count
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
