const test = require("node:test");
const assert = require("node:assert/strict");

const { REDACTED, redactConfigSecrets, mergeConfigPreservingSecrets } = require("../payload/extension/out/byok/ui/config-io");

function makeCfg({ officialToken, providerKey, headers } = {}) {
  return {
    version: 1,
    official: { completionUrl: "https://ace.cctv.mba/", apiToken: officialToken || "" },
    providers: [
      {
        id: "p1",
        type: "openai_compatible",
        baseUrl: "https://example.com/v1",
        apiKey: providerKey || "",
        headers: headers || {},
        models: ["m1"],
        defaultModel: "m1",
        requestDefaults: {}
      }
    ],
    routing: { rules: {} },
    prompts: { endpointSystem: {} },
    historySummary: { enabled: false, providerId: "", model: "" }
  };
}

test("config-io: redactConfigSecrets redacts official/apiKey/auth headers", () => {
  const cfg = makeCfg({
    officialToken: "ace_secret",
    providerKey: "sk-secret",
    headers: { Authorization: "Bearer X", "x-api-key": "Y", other: "Z" }
  });
  const redacted = redactConfigSecrets(cfg);

  assert.equal(redacted.official.apiToken, REDACTED);
  assert.equal(redacted.providers[0].apiKey, REDACTED);
  assert.equal(redacted.providers[0].headers.Authorization, REDACTED);
  assert.equal(redacted.providers[0].headers["x-api-key"], REDACTED);
  assert.equal(redacted.providers[0].headers.other, "Z");
});

test("config-io: mergeConfigPreservingSecrets keeps current secrets when incoming is <redacted>/missing", () => {
  const current = makeCfg({
    officialToken: "ace_current",
    providerKey: "sk-current",
    headers: { Authorization: "Bearer CUR", "x-api-key": "CUR2" }
  });
  const incoming = makeCfg({
    officialToken: REDACTED,
    providerKey: REDACTED,
    headers: { Authorization: REDACTED }
  });

  const merged = mergeConfigPreservingSecrets(current, incoming);

  assert.equal(merged.official.apiToken, "ace_current");
  assert.equal(merged.providers[0].apiKey, "sk-current");
  assert.equal(merged.providers[0].headers.Authorization, "Bearer CUR");
  assert.equal(merged.providers[0].headers["x-api-key"], "CUR2");
});

test("config-io: mergeConfigPreservingSecrets overwrites when incoming provides real secrets", () => {
  const current = makeCfg({
    officialToken: "ace_current",
    providerKey: "sk-current",
    headers: { Authorization: "Bearer CUR" }
  });
  const incoming = makeCfg({
    officialToken: "ace_new",
    providerKey: "sk-new",
    headers: { Authorization: "Bearer NEW" }
  });

  const merged = mergeConfigPreservingSecrets(current, incoming);
  assert.equal(merged.official.apiToken, "ace_new");
  assert.equal(merged.providers[0].apiKey, "sk-new");
  assert.equal(merged.providers[0].headers.Authorization, "Bearer NEW");
});

test("config-io: mergeConfigPreservingSecrets treats auth header keys case-insensitively", () => {
  const current = makeCfg({ headers: { Authorization: "Bearer CUR" } });
  const incoming = makeCfg({ headers: { authorization: REDACTED } });

  const merged = mergeConfigPreservingSecrets(current, incoming);
  assert.equal(merged.providers[0].headers.authorization, "Bearer CUR");
});
