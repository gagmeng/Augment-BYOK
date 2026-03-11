const test = require("node:test");
const assert = require("node:assert/strict");

const { analyze, hasStrictFailure } = require("../tools/check/official-delegation-audit");

test("official-delegation-audit: counts delegated miss lines with current log wording", () => {
  const summary = analyze([
    "[callApi] rid=1 ep=/completion mode=byok",
    "official text assembler delegated miss: ep=/completion reason=invalid_request_body",
    "official text assembler delegation failed: invalid_request_body"
  ]);

  assert.equal(summary.textMiss, 1);
  assert.equal(summary.textFail, 1);
  const completion = summary.perEndpoint.find((row) => row.endpoint === "/completion");
  assert.ok(completion);
  assert.equal(completion.missCount, 1);
});

test("official-delegation-audit: strict mode fails on partial endpoint coverage", () => {
  const summary = analyze([
    "[callApi] rid=1 ep=/completion mode=byok",
    "[callApi] rid=2 ep=/completion mode=byok",
    "official text assembler delegated: ep=/completion source=upstream.callApiBody.input",
    "official text assembler delegated miss: ep=/completion reason=invalid_request_body"
  ]);

  assert.equal(summary.textMiss, 1);
  const completion = summary.perEndpoint.find((row) => row.endpoint === "/completion");
  assert.ok(completion);
  assert.equal(completion.routeByokCount, 2);
  assert.equal(completion.delegatedCount, 1);
  assert.equal(completion.missCount, 1);
  assert.equal(hasStrictFailure(summary), true);
});

test("official-delegation-audit: strict mode passes on full coverage without miss/fail", () => {
  const summary = analyze([
    "[callApi] rid=1 ep=/completion mode=byok",
    "official text assembler delegated: ep=/completion source=upstream.callApiBody.input",
    "[callApi] rid=2 ep=/chat mode=byok",
    "official assembler delegated: ep=/chat source=upstream.callApiBody",
    "[callApiStream] rid=3 ep=/chat-stream mode=byok",
    "official assembler delegated: ep=/chat-stream source=upstream.callApiBody"
  ]);

  assert.equal(hasStrictFailure(summary), false);
});
