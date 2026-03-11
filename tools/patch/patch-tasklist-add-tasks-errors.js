#!/usr/bin/env node
"use strict";

const path = require("path");

const { replaceOnceRegex } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");
const { buildTaskFailuresSummarySnippet } = require("./tasklist-common");

const MARKER = "__augment_byok_tasklist_add_tasks_errors_patched_v1";

function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patchTasklistAddTasksErrors(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  let next = original;

  // Upstream add_tasks swallows per-task creation errors inside handleBatchCreation and returns
  // "Created: 0, Updated: 0, Deleted: 0" with no error details.
  // Patch: if any tasks fail, append failure summary; if all fail, return isError=true with details.
  // Updated for v0.801+: new pattern with getOrCreateTaskListId, simpler return structure
  // Pattern: handleBatchCreation(r,n){...let s=[];for(...)...let a=...getHydratedTask(i);...let c=p1.formatBulkUpdateResponse(kF(o,a));return{...nr(c),plan:a}}
  next = replaceOnceRegex(
    next,
    /async handleBatchCreation\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{let\s+([A-Za-z_$][\w$]*)=await this\._taskManager\.getOrCreateTaskListId\(\1\);[\s\S]*?let\s+([A-Za-z_$][\w$]*)=\[\];[\s\S]*?let\s+([A-Za-z_$][\w$]*)=await this\._taskManager\.getHydratedTask\(\3\);[\s\S]*?let\s+([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.formatBulkUpdateResponse\(([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*,\5\)\);return\s*\{\.\.\.([A-Za-z_$][\w$]*)\(\6\),plan:\5\}\s*\}/g,
    (m) => {
      const convVar = String(m[1] || "");
      const tasksVar = String(m[2] || "");
      const rootVar = String(m[3] || "");
      const resultsVar = String(m[4] || "");
      const hydratedVar = String(m[5] || "");
      const textVar = String(m[6] || "");
      const formatterVar = String(m[7] || "");
      const diffFnVar = String(m[8] || "");
      const okFnVar = String(m[9] || "");

      if (!resultsVar || !textVar || !formatterVar || !diffFnVar || !okFnVar) {
        throw new Error("tasklist add_tasks errors: capture missing");
      }

      // Error function is typically 'et' in minified code
      const errFnVar = "et";

      const insertion = buildTaskFailuresSummarySnippet({
        resultsVar,
        errorFnVar: errFnVar,
        textVar,
        planVar: hydratedVar
      });

      // Find the old tail pattern in the match
      const oldTail = `let ${textVar}=${formatterVar}.formatBulkUpdateResponse(${diffFnVar}(o,${hydratedVar}));return{...${okFnVar}(${textVar}),plan:${hydratedVar}}}`;
      const newTail = `let ${textVar}=${formatterVar}.formatBulkUpdateResponse(${diffFnVar}(o,${hydratedVar}));${insertion}return{...${okFnVar}(${textVar}),plan:${hydratedVar}}}`;

      if (!m[0].includes(oldTail)) throw new Error("tasklist add_tasks errors: tail not found (upstream may have changed)");
      return m[0].replace(oldTail, newTail);
    },
    "tasklist add_tasks errors: handleBatchCreation"
  );

  savePatchText(filePath, next, { marker: MARKER });
  return { changed: true, reason: "patched" };
}

module.exports = { patchTasklistAddTasksErrors };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchTasklistAddTasksErrors(filePath);
}
