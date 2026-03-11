const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { patchTasklistAddTasksErrors } = require("../tools/patch/patch-tasklist-add-tasks-errors");

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

test("patchTasklistAddTasksErrors: patches handleBatchCreation with non-Qk diff helper", () => {
  withTempDir("augment-byok-task-errors-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = [
      `class AddTasksTool{`,
      `  async handleBatchCreation(r,n){`,
      `    let i=this._taskManager.getRootTaskUuid(r);`,
      `    if(!i)return it("No root task found.");`,
      "    let o=await this._taskManager.getHydratedTask(i);",
      "    if(!o)return it(`Task with UUID ${i} not found.`);",
      "    let s=[];",
      "    for(let l of n)try{let u=await this.createSingleTaskFromInput(r,l);s.push({taskId:u.taskId,taskName:u.taskName,success:!0})}catch(u){let d=l.name;s.push({taskName:d||\"unknown\",success:!1,error:u instanceof Error?u.message:String(u)})}",
      "    let a=await this._taskManager.getHydratedTask(i);",
      "    if(!a)return it(\"Failed to retrieve updated task tree.\");",
      "    let c=V0.formatBulkUpdateResponse(Zk(o,a));",
      "    return{...xr(c),plan:a}",
      "  }",
      "}"
    ].join("\n");
    writeUtf8(filePath, src);

    const r1 = patchTasklistAddTasksErrors(filePath);
    assert.equal(r1.changed, true);

    const out1 = readUtf8(filePath);
    assert.ok(out1.includes("__augment_byok_tasklist_add_tasks_errors_patched_v1"));
    assert.ok(out1.includes("let __byok_failed=s.filter(t=>t&&t.success===!1);"));
    assert.ok(out1.includes('Task creation failures ("+String(__byok_failed.length)+"/"+String(s.length)+"):\\n'));
    assert.ok(out1.includes('return{...it("Failed to add task(s)."+__byok_msg),plan:a}'));
    assert.ok(out1.includes("let c=V0.formatBulkUpdateResponse(Zk(o,a));let __byok_failed=s.filter"));

    const r2 = patchTasklistAddTasksErrors(filePath);
    assert.equal(r2.changed, false);
    const out2 = readUtf8(filePath);
    assert.equal(out2, out1);
  });
});
