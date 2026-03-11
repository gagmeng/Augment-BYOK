#!/usr/bin/env node
"use strict";

const path = require("path");

const { replaceOnceRegex } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");
const { requireCapture, buildSanitizeOptionalTaskIdsSnippet } = require("./tasklist-common");

const MARKER = "__augment_byok_tasklist_add_tasks_sanitize_empty_ids_patched_v1";

function patchTasklistAddTasksSanitizeEmptyIds(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  let next = original;

  // Upstream validation treats empty-string optional IDs as "provided" and fails the whole task create.
  // Patch: in add_tasks' batch loop, coerce whitespace/empty parent_task_id/after_task_id to "unset"
  // before calling createSingleTaskFromInput.
  next = replaceOnceRegex(
    next,
    /for\(let\s+([A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$]*)\)try\{let\s+([A-Za-z_$][\w$]*)=await\s+this\.createSingleTaskFromInput\(([A-Za-z_$][\w$]*),\1\);/g,
    (m) => {
      const label = "tasklist add_tasks sanitize empty ids";
      const itemVar = requireCapture(m, 1, `${label} itemVar`);
      const tasksVar = requireCapture(m, 2, `${label} tasksVar`);
      const resultVar = requireCapture(m, 3, `${label} resultVar`);
      const convVar = requireCapture(m, 4, `${label} convVar`);
      const sanitize = buildSanitizeOptionalTaskIdsSnippet(itemVar);

      return `for(let ${itemVar} of ${tasksVar})try{${sanitize}let ${resultVar}=await this.createSingleTaskFromInput(${convVar},${itemVar});`;
    },
    "tasklist add_tasks sanitize empty ids: batch loop"
  );

  savePatchText(filePath, next, { marker: MARKER });
  return { changed: true, reason: "patched" };
}

module.exports = { patchTasklistAddTasksSanitizeEmptyIds };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchTasklistAddTasksSanitizeEmptyIds(filePath);
}
