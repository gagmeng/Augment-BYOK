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
  // Match: handleBatchCreation with let s=[] results array and formatBulkUpdateResponse return
  next = replaceOnceRegex(
    next,
    /async handleBatchCreation\([^)]+\)\{[\s\S]*?let\s+([A-Za-z_$][\w$]*)=\[\];[\s\S]*?let\s+([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.formatBulkUpdateResponse\(([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*,([A-Za-z_$][\w$]*)\)\);[\s\S]*?return\s*\{\.\.\.([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*\),plan:[A-Za-z_$][\w$]*\}/g,
    (m) => {
      const resultsVar = String(m[1] || "");
      const textVar = String(m[2] || "");
      const formatterVar = String(m[3] || "");
      const diffFnVar = String(m[4] || "");
      const hydratedVar = String(m[5] || "");
      const okFnVar = String(m[6] || "");

      if (!resultsVar || !textVar || !formatterVar || !diffFnVar || !okFnVar) {
        throw new Error("tasklist add_tasks errors: capture missing");
      }

      // Error function is typically 'et' in minified code
      const errFnVar = "et";

      // Find the old tail pattern in the match - handle whitespace between ; and return
      const oldTailRe = new RegExp(`let\\s+${textVar}=${formatterVar}\\.formatBulkUpdateResponse\\(${diffFnVar}\\(o,${hydratedVar}\\)\\);[\\s\\S]*?return\\s*\\{\\.\\.\\.${okFnVar}\\(${textVar}\\),plan:${hydratedVar}\\}`);
      const oldMatch = m[0].match(oldTailRe);
      if (!oldMatch) throw new Error("tasklist add_tasks errors: tail not found (upstream may have changed)");
      
      const insertion = buildTaskFailuresSummarySnippet({
        resultsVar,
        errorFnVar: errFnVar,
        textVar,
        planVar: hydratedVar
      });

      const newTail = `let ${textVar}=${formatterVar}.formatBulkUpdateResponse(${diffFnVar}(o,${hydratedVar}));${insertion}return{...${okFnVar}(${textVar}),plan:${hydratedVar}}`;
      return m[0].replace(oldMatch[0], newTail);
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
