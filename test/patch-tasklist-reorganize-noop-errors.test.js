const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { patchTasklistReorganizeNoopErrors } = require("../tools/patch/patch-tasklist-reorganize-noop-errors");

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

test("patchTasklistReorganizeNoopErrors: marks no-op reorganize as error", () => {
  withTempDir("augment-byok-task-reorg-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = [
      `class ReorganizeTool{`,
      `  async call(t,e,o,n,r,s){`,
      `    let i=r.markdown;if(!i)return it("No markdown provided.");`,
      `    let a=this._taskManager.getRootTaskUuid(s);if(!a)return it("No root task found.");`,
      "    let l=await this._taskManager.getHydratedTask(a);",
      "    if(!l)return it(`Task with UUID ${a} not found.`);",
      "    let u=await this._taskManager.getHydratedTask(a);",
      "    if(!u)return it(\"Failed to retrieve updated task tree.\");",
      "    let d=V0.formatBulkUpdateResponse(Zk(l,u));",
      "    return{...xr(d),plan:u}",
      "  }",
      "}"
    ].join("\n");
    writeUtf8(filePath, src);

    const r1 = patchTasklistReorganizeNoopErrors(filePath);
    assert.equal(r1.changed, true);

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_tasklist_reorganize_noop_errors_patched_v1"));
    assert.ok(out1.includes("let __byok_reorg_diff=Zk(l,u);"));
    assert.ok(out1.includes("let __byok_reorg_count=[__byok_reorg_diff&&__byok_reorg_diff.created"));
    assert.ok(out1.includes('return{...it("Task list reorganization produced no changes."),plan:u}'));
    assert.ok(out1.includes("let d=V0.formatBulkUpdateResponse(__byok_reorg_diff);"));

    const r2 = patchTasklistReorganizeNoopErrors(filePath);
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});
