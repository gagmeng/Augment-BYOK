const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { guardNoAutoAuth } = require("../tools/patch/guard-no-autoauth");
const { patchAugmentInterceptorInject } = require("../tools/patch/patch-augment-interceptor-inject");
const { patchCallApiShim } = require("../tools/patch/patch-callapi-shim");
const { patchExposeUpstream } = require("../tools/patch/patch-expose-upstream");
const { patchExtensionEntry } = require("../tools/patch/patch-extension-entry");
const { patchMemoriesUpperBoundSize } = require("../tools/patch/patch-memories-upper-bound-size");
const { patchModelPickerByokOnly } = require("../tools/patch/patch-model-picker-byok-only");
const { patchByokAuthSession } = require("../tools/patch/patch-byok-auth-session");
const { patchOfficialOverrides } = require("../tools/patch/patch-official-overrides");
const { patchPackageJsonCommands } = require("../tools/patch/patch-package-json-commands");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeUtf8(filePath, content) {
  fs.writeFileSync(filePath, content, "utf8");
}

test("guardNoAutoAuth: passes when /autoAuth absent", () => {
  withTempDir("augment-byok-guard-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    writeUtf8(filePath, `console.log("ok");\n`);
    assert.deepEqual(guardNoAutoAuth(filePath), { ok: true });
  });
});

test("guardNoAutoAuth: fails fast when /autoAuth present", () => {
  withTempDir("augment-byok-guard-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    writeUtf8(filePath, `switch (x) { case "/autoAuth": break; }\n`);
    assert.throws(() => guardNoAutoAuth(filePath), /autoAuth guard failed/i);
  });
});

test("patchExtensionEntry: injects bootstrap and is idempotent", () => {
  withTempDir("augment-byok-patch-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = [
      `"use strict";`,
      `let a=()=>{};`,
      `const exportsObj={activate:()=>a};`,
      `console.log(exportsObj);`,
      `//# sourceMappingURL=extension.js.map`
    ].join("\n");
    writeUtf8(filePath, src);

    const r1 = patchExtensionEntry(filePath);
    assert.equal(r1.changed, true);
    assert.equal(r1.activateVar, "a");

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes(`require("./byok/runtime/bootstrap")`));
    assert.ok(out1.includes("__augment_byok_bootstrap_injected_v1"));
    assert.ok(out1.indexOf("__augment_byok_bootstrap_injected_v1") < out1.indexOf("\n//# sourceMappingURL="));

    const r2 = patchExtensionEntry(filePath);
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});

test("patchCallApiShim: injects callApi/callApiStream and is idempotent", () => {
  withTempDir("augment-byok-patch-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = [
      `class C{`,
      `  async callApi(a,b,c,d,e,f,g,h,i,j,k){return {a,b,c,d,e,f,g,h,i,j,k};}`,
      `  async callApiStream(a,b,c,d,e,f){return {a,b,c,d,e,f};}`,
      `}`,
      `exports.C=C;`
    ].join("\n");
    writeUtf8(filePath, src);

    const r1 = patchCallApiShim(filePath);
    assert.equal(r1.changed, true);
    assert.equal(r1.callApiPatched, 1);
    assert.equal(r1.callApiStreamPatched, 1);

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_callapi_shim_patched_v1"));
    assert.ok(out1.includes(`require("./byok/runtime/shim/call-api").maybeHandleCallApi`));
    assert.ok(out1.includes(`require("./byok/runtime/shim/call-api-stream").maybeHandleCallApiStream`));

    const r2 = patchCallApiShim(filePath);
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});

test("patchModelPickerByokOnly: injects BYOK-only model filter and is idempotent", () => {
  withTempDir("augment-byok-patch-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = [
      `"use strict";`,
      `class DJ{`,
      `  getMergedAdditionalChatModels=()=>{return {}};`,
      `}`,
      `exports.DJ=DJ;`,
      `//# sourceMappingURL=extension.js.map`
    ].join("\n");
    writeUtf8(filePath, src);

    const r1 = patchModelPickerByokOnly(filePath);
    assert.equal(r1.changed, true);
    assert.equal(r1.patched, 1);

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_model_picker_byok_only_v1"));
    assert.ok(out1.includes(`require("./byok/config/state").state`));
    assert.ok(out1.includes(`require("./byok/core/model-picker").getMergedAdditionalChatModelsByokOnly`));

    const r2 = patchModelPickerByokOnly(filePath);
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});

test("patchMemoriesUpperBoundSize: injects fallback upper_bound_size and is idempotent", () => {
  withTempDir("augment-byok-patch-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = [
      `"use strict";`,
      `function X(){return {flags:{memoriesParams:{upper_bound_size:321}}};}`,
      `class M{`,
      `  run(){let a=X().flags.memoriesParams.upper_bound_size;return a;}`,
      `}`,
      `exports.M=M;`
    ].join("\n");
    writeUtf8(filePath, src);

    const r1 = patchMemoriesUpperBoundSize(filePath, { defaultUpperBoundSize: 10000 });
    assert.equal(r1.changed, true);
    assert.equal(r1.defaultUpperBoundSize, 10000);

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_memories_upper_bound_size_patched_v1"));
    assert.ok(out1.includes("let __byok_memoriesParams=X().flags.memoriesParams;"));
    assert.ok(out1.includes("let a=(__byok_memoriesParams&&__byok_memoriesParams.upper_bound_size)||10000;"));

    const r2 = patchMemoriesUpperBoundSize(filePath, { defaultUpperBoundSize: 10000 });
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});

test("patchExposeUpstream: captures AugmentExtension instance and is idempotent", () => {
  withTempDir("augment-byok-patch-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = [
      `const __exp={AugmentExtension:()=>D6,activate:()=>a};`,
      `let a=()=>{};`,
      `class D6{}`,
      `let inst=new D6(1);`,
      `console.log(__exp,inst);`
    ].join("\n");
    writeUtf8(filePath, src);

    const r1 = patchExposeUpstream(filePath);
    assert.equal(r1.changed, true);
    assert.equal(r1.classIdent, "D6");
    assert.equal(r1.varName, "inst");

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_expose_upstream_v1"));
    assert.ok(out1.includes("globalThis.__augment_byok_upstream.augmentExtension=inst;"));
    assert.ok(out1.includes("globalThis.__augment_byok_upstream.officialChatDelegation=inst;"));

    const r2 = patchExposeUpstream(filePath);
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});

test("patchAugmentInterceptorInject: prepends inject-code and is idempotent", () => {
  withTempDir("augment-byok-patch-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    writeUtf8(filePath, `console.log("upstream");\n`);

    const injectPath = path.join(dir, "inject.txt");
    const injectCode = [
      `/* Augment Interceptor Injection Start */`,
      `console.log("inject");`,
      `/* Augment Interceptor Injection End */`
    ].join("\n");
    writeUtf8(injectPath, injectCode);

    const r1 = patchAugmentInterceptorInject(filePath, { injectPath });
    assert.equal(r1.changed, true);

    const out1 = readUtf8(filePath);
    assert.ok(out1.startsWith(injectCode));
    assert.ok(out1.includes("__augment_byok_augment_interceptor_injected_v1"));

    const r2 = patchAugmentInterceptorInject(filePath, { injectPath });
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});

test("patchPackageJsonCommands: adds BYOK commands, strips augment.advanced.*, and is idempotent", () => {
  withTempDir("augment-byok-patch-", (dir) => {
    const filePath = path.join(dir, "package.json");
    writeUtf8(
      filePath,
      JSON.stringify(
        {
          name: "x",
          contributes: {
            commands: [{ command: "existing.cmd", title: "Existing" }],
            configuration: {
              properties: {
                "augment.advanced.apiToken": { type: "string" },
                "augment.advanced.completionURL": { type: "string" },
                "augment.advanced.chat": { type: "string" },
                "augment.advanced.codeEdits": { type: "string" },
                "augment.advanced": {
                  type: "object",
                  properties: {
                    apiToken: { type: "string" },
                    completionURL: { type: "string" },
                    chat: { type: "string" },
                    codeEdits: { type: "string" },
                    keep: { type: "string" }
                  }
                },
                "other.setting": { type: "boolean" }
              }
            }
          }
        },
        null,
        2
      ) + "\n"
    );

    patchPackageJsonCommands(filePath);

    const pkg1 = JSON.parse(readUtf8(filePath));
    const commands1 = (pkg1.contributes && pkg1.contributes.commands) || [];
    const commandIds1 = new Set(commands1.map((c) => c.command));
    assert.ok(commandIds1.has("augment-byok.enable"));
    assert.ok(commandIds1.has("augment-byok.disable"));
    assert.ok(commandIds1.has("augment-byok.reloadConfig"));
    assert.ok(commandIds1.has("augment-byok.openConfigPanel"));
    assert.ok(commandIds1.has("augment-byok.clearHistorySummaryCache"));

    const props1 = pkg1.contributes.configuration.properties;
    for (const k of Object.keys(props1)) {
      assert.ok(!k.startsWith("augment.advanced."), `unexpected advanced setting key: ${k}`);
    }
    assert.ok(props1["augment.advanced"]);
    assert.ok(props1["augment.advanced"].properties);
    assert.ok(!Object.prototype.hasOwnProperty.call(props1["augment.advanced"].properties, "apiToken"));
    assert.ok(!Object.prototype.hasOwnProperty.call(props1["augment.advanced"].properties, "completionURL"));
    assert.ok(!Object.prototype.hasOwnProperty.call(props1["augment.advanced"].properties, "chat"));
    assert.ok(!Object.prototype.hasOwnProperty.call(props1["augment.advanced"].properties, "codeEdits"));
    assert.ok(Object.prototype.hasOwnProperty.call(props1["augment.advanced"].properties, "keep"));

    patchPackageJsonCommands(filePath);
    const pkg2 = JSON.parse(readUtf8(filePath));
    const commands2 = (pkg2.contributes && pkg2.contributes.commands) || [];
    const ids2 = commands2.map((c) => c.command);
    assert.equal(new Set(ids2).size, ids2.length);
  });
});

test("patchOfficialOverrides: applies expected replacements and is idempotent", () => {
  withTempDir("augment-byok-patch-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = [
      `class ClientAuth{`,
      `  async getAPIToken(){return this.configListener.config.apiToken}`,
      `  async getCompletionURL(){return this.configListener.config.completionURL}`,
      `}`,
      ``,
      `class ApiClient{`,
      `  async makeAuthenticatedCall(t,r,n,i="POST",o,s){`,
      `    const c="https://example.com/root/";`,
      `    const u=new URL(t,c)`,
      `    return {u};`,
      `  }`,
      `  async makeAuthenticatedCallStream(t,r,n,i="post",o){`,
      `    const c={tenantUrl:"https://example.com/root/"};`,
      `    const u=new URL(t,c.tenantUrl)`,
      `    return {u};`,
      `  }`,
      `  async callApi(p0,p1,p2,p3,p4,baseUrl,p6,p7,p8,p9,apiToken){`,
      `    return {baseUrl,apiToken};`,
      `  }`,
      `  async callApiStream(p0,p1,p2,p3,p4,u){`,
      `    return {u};`,
      `  }`,
      `}`,
      `exports.ApiClient=ApiClient;`
    ].join("\n");
    writeUtf8(filePath, src);

    const r1 = patchOfficialOverrides(filePath);
    assert.equal(r1.changed, true);
    assert.equal(r1.getApiTokenPatched, 1);
    assert.equal(r1.getCompletionURLPatched, 1);
    assert.equal(r1.makeAuthenticatedCallPatched, 1);
    assert.equal(r1.makeAuthenticatedCallStreamPatched, 1);
    assert.equal(r1.callApiPatched, 1);
    assert.equal(r1.callApiStreamPatched, 1);

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_official_overrides_patched_v1"));

    assert.ok(out1.includes('const __byok_off=require("./byok/config/official");const __byok_conn=__byok_off.getOfficialConnection();'));
    assert.ok(out1.includes("if(__byok_conn.apiToken)return __byok_conn.apiToken"));
    assert.ok(out1.includes("if(__byok_conn.apiToken&&__byok_conn.completionURL)return __byok_conn.completionURL"));
    assert.ok(out1.includes('if(typeof t==="string"&&t[0]==="/")t=t.slice(1);'));
    assert.ok(out1.includes("if(__byok_conn.apiToken&&!__byok_useOAuth){if(__byok_conn.completionURL)baseUrl=__byok_conn.completionURL;apiToken=__byok_conn.apiToken;}"));
    assert.ok(out1.includes('if(baseUrl==null||baseUrl==="")baseUrl=await this.clientAuth.getCompletionURL();'));
    assert.ok(out1.includes('if(apiToken==null||apiToken==="")apiToken=await this.clientAuth.getAPIToken();'));
    assert.ok(out1.includes("if(__byok_conn.apiToken&&__byok_conn.completionURL&&!__byok_useOAuth)u=__byok_conn.completionURL;"));
    assert.ok(out1.includes('if(u==null||u==="")u=await this.clientAuth.getCompletionURL();'));

    const r2 = patchOfficialOverrides(filePath);
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});

test("patchByokAuthSession: injects BYOK session fallback and is idempotent", () => {
  withTempDir("augment-byok-patch-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = [
      `var Vx={commands:{executeCommand(){}}};`,
      `class AuthSessionStore{`,
      `  async initState(){this._isLoggedIn=!!await this.getSession();}`,
      `  async getSession(){return await this._context.secrets.get("augment.sessions");}`,
      `}`,
      `exports.AuthSessionStore=AuthSessionStore;`
    ].join("\n");
    writeUtf8(filePath, src);

    const r1 = patchByokAuthSession(filePath);
    assert.equal(r1.changed, true);
    assert.equal(r1.getSessionPatched, 1);
    assert.equal(r1.initStatePatched, 1);

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_auth_session_patched_v1"));
    assert.ok(out1.includes('const __byok_auth=require("./byok/runtime/auth-session");'));
    assert.ok(out1.includes('const __byok_session=__byok_auth.getByokOfficialSession();'));
    assert.ok(out1.includes('if(__byok_session)return __byok_session;'));
    assert.ok(out1.includes('__byok_auth.syncByokAuthState({store:this,commands:Vx.commands});'));

    const r2 = patchByokAuthSession(filePath);
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});
