const test = require("node:test");
const assert = require("node:assert/strict");

function loadFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test("infra-log: audit logs emit even when debug disabled", () => {
  const prev = process.env.AUGMENT_BYOK_DEBUG;
  const origLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    delete process.env.AUGMENT_BYOK_DEBUG;
    const log = loadFresh("../payload/extension/out/byok/infra/log");
    log.debug("debug-hidden");
    log.audit("audit-visible");
  } finally {
    console.log = origLog;
    if (prev === undefined) delete process.env.AUGMENT_BYOK_DEBUG;
    else process.env.AUGMENT_BYOK_DEBUG = prev;
    loadFresh("../payload/extension/out/byok/infra/log");
  }

  assert.equal(lines.some((line) => line.includes("debug-hidden")), false);
  assert.equal(lines.some((line) => line.includes("audit-visible")), true);
});
