const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { patchTasklistAddTasksSanitizeEmptyIds } = require("../tools/patch/patch-tasklist-add-tasks-sanitize-empty-ids");

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

test("patchTasklistAddTasksSanitizeEmptyIds: strips empty optional ids before createSingleTaskFromInput", () => {
  withTempDir("augment-byok-task-sanitize-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = [
      `class AddTasksTool{`,
      `  async handleBatchCreation(r,n){`,
      `    for(let l of n)try{let u=await this.createSingleTaskFromInput(r,l);console.log(u)}catch(u){console.log(u)}`,
      `  }`,
      `}`
    ].join("\n");
    writeUtf8(filePath, src);

    const r1 = patchTasklistAddTasksSanitizeEmptyIds(filePath);
    assert.equal(r1.changed, true);

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_tasklist_add_tasks_sanitize_empty_ids_patched_v1"));
    assert.ok(out1.includes('typeof l.parent_task_id==="string"&&l.parent_task_id.trim()===""&&delete l.parent_task_id;'));
    assert.ok(out1.includes('typeof l.after_task_id==="string"&&l.after_task_id.trim()===""&&delete l.after_task_id;'));

    const r2 = patchTasklistAddTasksSanitizeEmptyIds(filePath);
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});
