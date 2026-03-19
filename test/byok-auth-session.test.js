const test = require("node:test");
const assert = require("node:assert/strict");

const authSession = require("../payload/extension/out/byok/runtime/auth-session");
const official = require("../payload/extension/out/byok/config/official");

test("syncByokAuthState: sets logged-in contexts when official connection is complete", () => {
  const original = official.getOfficialConnection;
  official.getOfficialConnection = () => ({ completionURL: "https://ace.cctv.mba/", apiToken: "tok" });

  const calls = [];
  const store = { _isLoggedIn: false };
  const commands = { executeCommand: (...args) => calls.push(args) };

  try {
    const loggedIn = authSession.syncByokAuthState({ store, commands });
    assert.equal(loggedIn, true);
    assert.equal(store._isLoggedIn, true);
    assert.deepEqual(calls, [
      ["setContext", "vscode-augment.isLoggedIn", true],
      ["setContext", "vscode-augment.useOAuth", false]
    ]);
  } finally {
    official.getOfficialConnection = original;
  }
});

test("syncByokAuthState: clears logged-in context when official token is missing", () => {
  const original = official.getOfficialConnection;
  official.getOfficialConnection = () => ({ completionURL: "https://ace.cctv.mba/", apiToken: "" });

  const calls = [];
  const store = { _isLoggedIn: true };
  const commands = { executeCommand: (...args) => calls.push(args) };

  try {
    const loggedIn = authSession.syncByokAuthState({ store, commands });
    assert.equal(loggedIn, false);
    assert.equal(store._isLoggedIn, false);
    assert.deepEqual(calls, [
      ["setContext", "vscode-augment.isLoggedIn", false],
      ["setContext", "vscode-augment.useOAuth", false]
    ]);
  } finally {
    official.getOfficialConnection = original;
  }
});
