const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadPatchJson, loadPatchText, savePatchJson, savePatchText } = require("../tools/patch/patch-target");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("patch-target: load/save text keeps marker semantics centralized", () => {
  withTempDir("augment-byok-patch-target-", (dir) => {
    const filePath = path.join(dir, "fixture.js");
    fs.writeFileSync(filePath, "console.log('ok');\n", "utf8");

    assert.equal(loadPatchText(filePath, { marker: "__marker__" }).alreadyPatched, false);

    savePatchText(filePath, "console.log('patched');\n", { marker: "__marker__" });
    const after = loadPatchText(filePath, { marker: "__marker__" });

    assert.equal(after.alreadyPatched, true);
    assert.match(after.original, /console\.log\('patched'\)/);
    assert.match(after.original, /__marker__/);
  });
});

test("patch-target: load/save json roundtrips object values", () => {
  withTempDir("augment-byok-patch-target-", (dir) => {
    const filePath = path.join(dir, "fixture.json");
    savePatchJson(filePath, { a: 1, b: ["x"] });

    assert.deepEqual(loadPatchJson(filePath), { a: 1, b: ["x"] });
  });
});
