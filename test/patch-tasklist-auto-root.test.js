const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { patchTasklistAutoRoot } = require("../tools/patch/patch-tasklist-auto-root");

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

test("patchTasklistAutoRoot: injects createNewTaskList fallback for tasklist entry points", () => {
  withTempDir("augment-byok-task-auto-root-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = [
      `class TaskTool{`,
      `  async call(a,b,c,d,e,f){try{let g=this._taskManager.getRootTaskUuid(f);if(!g)return it("No root task found.");return {plan:g}}catch{return it("x")}}`,
      `  async handleBatchUpdate(a,b){let c=this._taskManager.getRootTaskUuid(a);if(!c)return it("No root task found.");return {plan:c}}`,
      `  async handleBatchCreation(a,b){let c=this._taskManager.getRootTaskUuid(a);if(!c)return it("No root task found.");return {plan:c}}`,
      `  async other(r,s){let m=r.markdown;if(!m)return it("No markdown provided.");let c=this._taskManager.getRootTaskUuid(s);if(!c)return it("No root task found.");return {plan:c}}`,
      `}`
    ].join("\n");
    writeUtf8(filePath, src);

    const r1 = patchTasklistAutoRoot(filePath);
    assert.equal(r1.changed, true);

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_tasklist_auto_root_patched_v1"));
    assert.ok(out1.includes('typeof this._taskManager.createNewTaskList==="function"'));
    assert.ok(out1.includes("await this._taskManager.createNewTaskList(f)"));
    assert.ok(out1.includes("await this._taskManager.createNewTaskList(a)"));
    assert.ok(out1.includes("await this._taskManager.createNewTaskList(s)"));

    const r2 = patchTasklistAutoRoot(filePath);
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});
