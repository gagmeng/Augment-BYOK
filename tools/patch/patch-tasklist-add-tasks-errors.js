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
  next = replaceOnceRegex(
    next,
    /async handleBatchCreation\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{[\s\S]*?let\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\.formatBulkUpdateResponse\(([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\)\s*;[\s\S]*?return\s*\{\.\.\.([A-Za-z_$][\w$]*)\(\3\),plan:\7\}\s*\}/g,
    (m) => {
      const textVar = String(m[3] || "");
      const formatterVar = String(m[4] || "");
      const diffFnVar = String(m[5] || "");
      const beforeVar = String(m[6] || "");
      const afterVar = String(m[7] || "");
      const okFnVar = String(m[8] || "");
      if (!textVar || !formatterVar || !diffFnVar || !beforeVar || !afterVar || !okFnVar) {
        throw new Error("tasklist add_tasks errors: capture missing");
      }

      const resultsCapture = m[0].match(/let\s+([A-Za-z_$][\w$]*)\s*=\s*\[\]\s*;\s*for\(let/);
      const resultsVar = String(resultsCapture?.[1] || "");
      if (!resultsVar) throw new Error("tasklist add_tasks errors: results capture missing");

      const errFnCapture = m[0].match(/return\s+([A-Za-z_$][\w$]*)\("No root task found\."\);/);
      const errFnVar = String(errFnCapture?.[1] || "");
      if (!errFnVar) throw new Error("tasklist add_tasks errors: error fn capture missing");

      const oldTailRe = new RegExp(
        `let\\s+${escapeRegExp(textVar)}\\s*=\\s*${escapeRegExp(formatterVar)}\\.formatBulkUpdateResponse\\(${escapeRegExp(diffFnVar)}\\(${escapeRegExp(
          beforeVar
        )},${escapeRegExp(afterVar)}\\)\\)\\s*;\\s*return\\s*\\{\\.\\.\\.${escapeRegExp(okFnVar)}\\(${escapeRegExp(textVar)}\\),plan:${escapeRegExp(
          afterVar
        )}\\}`,
        "g"
      );
      const insertion = buildTaskFailuresSummarySnippet({
        resultsVar,
        errorFnVar: errFnVar,
        textVar,
        planVar: afterVar
      });

      const newTail = `let ${textVar}=${formatterVar}.formatBulkUpdateResponse(${diffFnVar}(${beforeVar},${afterVar}));${insertion}return{...${okFnVar}(${textVar}),plan:${afterVar}}`;
      if (!oldTailRe.test(m[0])) throw new Error("tasklist add_tasks errors: tail not found (upstream may have changed)");
      oldTailRe.lastIndex = 0;
      return m[0].replace(oldTailRe, newTail);
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
