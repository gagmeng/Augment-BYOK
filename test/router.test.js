const test = require("node:test");
const assert = require("node:assert/strict");

const { defaultConfig } = require("../payload/extension/out/byok/config/config");
const { decideRoute } = require("../payload/extension/out/byok/core/router");

test("decideRoute: empty endpoint => official", () => {
  const cfg = defaultConfig();
  const r = decideRoute({ cfg, endpoint: "", body: {}, runtimeEnabled: true });
  assert.equal(r.mode, "official");
  assert.equal(r.reason, "empty_endpoint");
});

test("decideRoute: runtime disabled => rollback to official", () => {
  const cfg = defaultConfig();
  const r = decideRoute({ cfg, endpoint: "/chat", body: { model: "byok:openai:gpt-4o-mini" }, runtimeEnabled: false });
  assert.equal(r.mode, "official");
  assert.equal(r.endpoint, "/chat");
  assert.equal(r.reason, "rollback_disabled");
});

test("decideRoute: byok (default rule) picks provider/model from byok:model", () => {
  const cfg = defaultConfig();
  const r = decideRoute({ cfg, endpoint: "/chat-stream", body: { model: "byok:openai:gpt-4o-mini" }, runtimeEnabled: true });
  assert.equal(r.mode, "byok");
  assert.equal(r.endpoint, "/chat-stream");
  assert.equal(r.reason, "byok");
  assert.equal(r.provider.id, "openai");
  assert.equal(r.model, "gpt-4o-mini");
});

test("decideRoute: accepts model_id (snake_case) from request body", () => {
  const cfg = defaultConfig();
  const r = decideRoute({ cfg, endpoint: "/chat-stream", body: { model_id: "byok:openai:gpt-4o" }, runtimeEnabled: true });
  assert.equal(r.mode, "byok");
  assert.equal(r.endpoint, "/chat-stream");
  assert.equal(r.provider.id, "openai");
  assert.equal(r.model, "gpt-4o");
});

test("decideRoute: model picker overrides endpoint rule model", () => {
  const cfg = defaultConfig();
  cfg.routing.rules["/chat-stream"] = { mode: "byok", providerId: "openai", model: "gpt-4o-mini" };
  const r = decideRoute({ cfg, endpoint: "/chat-stream", body: { model: "byok:openai:gpt-4o" }, runtimeEnabled: true });
  assert.equal(r.mode, "byok");
  assert.equal(r.endpoint, "/chat-stream");
  assert.equal(r.provider.id, "openai");
  assert.equal(r.model, "gpt-4o");
});

test("decideRoute: model picker overrides endpoint rule providerId", () => {
  const cfg = defaultConfig();
  cfg.routing.rules["/chat-stream"] = { mode: "byok", providerId: "openai", model: "gpt-4o-mini" };
  const r = decideRoute({
    cfg,
    endpoint: "/chat-stream",
    body: { model: "byok:anthropic:claude-3-5-sonnet-20241022" },
    runtimeEnabled: true
  });
  assert.equal(r.mode, "byok");
  assert.equal(r.endpoint, "/chat-stream");
  assert.equal(r.provider.id, "anthropic");
  assert.equal(r.model, "claude-3-5-sonnet-20241022");
});

test("decideRoute: disabled rule => disabled", () => {
  const cfg = defaultConfig();
  const r = decideRoute({ cfg, endpoint: "/user-secrets/list", body: { model: "byok:openai:gpt-4o-mini" }, runtimeEnabled: true });
  assert.equal(r.mode, "disabled");
  assert.equal(r.endpoint, "/user-secrets/list");
  assert.equal(r.reason, "rule");
});

test("decideRoute: model override forces byok when rule is official", () => {
  const cfg = defaultConfig();
  const r = decideRoute({ cfg, endpoint: "/record-request-events", body: { model: "byok:openai:gpt-4o-mini" }, runtimeEnabled: true });
  assert.equal(r.mode, "byok");
  assert.equal(r.endpoint, "/record-request-events");
  assert.equal(r.reason, "model_override");
  assert.equal(r.provider.id, "openai");
  assert.equal(r.model, "gpt-4o-mini");
});

test("decideRoute: empty routing.rules falls back to built-in defaults", () => {
  const cfg = defaultConfig();
  cfg.routing.rules = {};
  const r = decideRoute({ cfg, endpoint: "/get-models", body: {}, runtimeEnabled: true });
  assert.equal(r.mode, "byok");
  assert.equal(r.endpoint, "/get-models");
});

test("decideRoute: non-chat endpoint uses byok when rule is byok", () => {
  const cfg = defaultConfig();
  const r = decideRoute({ cfg, endpoint: "/completion", body: {}, runtimeEnabled: true });
  assert.equal(r.mode, "byok");
  assert.equal(r.endpoint, "/completion");
});

test("decideRoute: route object no longer carries delegation meta", () => {
  const cfg = defaultConfig();
  const r = decideRoute({ cfg, endpoint: "/chat-stream", body: {}, runtimeEnabled: true });
  assert.equal(r.mode, "byok");
  assert.equal(Object.prototype.hasOwnProperty.call(r, "delegateOfficialAssembler"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(r, "delegateExecutionOwner"), false);
});

test("decideRoute: missing configured provider falls back to official", () => {
  const cfg = defaultConfig();
  cfg.routing.rules["/completion"] = { mode: "byok", providerId: "missing-provider", model: "m1" };
  const r = decideRoute({ cfg, endpoint: "/completion", body: {}, runtimeEnabled: true });
  assert.equal(r.mode, "official");
  assert.equal(r.reason, "provider_missing");
  assert.equal(r.providerId, "missing-provider");
});
