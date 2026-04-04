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

  // Match handleBatchCreation: supports both old (separate let) and new (inlined ternary) patterns.
  // New upstream inlines formatBulkUpdateResponse in a ternary return:
  //   return HYDRATED?{...OK(FORMATTER.formatBulkUpdateResponse(DIFF(BEFORE,HYDRATED))),plan:HYDRATED}:ERR("...")
  const reInlined = /async handleBatchCreation\([^)]+\)\{[\s\S]*?(?:let|const)\s+([A-Za-z_$][\w$]*)=\[\];[\s\S]*?return\s+([A-Za-z_$][\w$]*)\?\{\.\.\.([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\.formatBulkUpdateResponse\(([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),\2\)\)\),plan:\2\}:([A-Za-z_$][\w$]*)\([^)]*\)/g;

  const reOld = /async handleBatchCreation\([^)]+\)\{[\s\S]*?(?:let|const)\s+([A-Za-z_$][\w$]*)=\[\];[\s\S]*?let\s+([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.formatBulkUpdateResponse\(([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*,([A-Za-z_$][\w$]*)\)\);[\s\S]*?return\s*\{\.\.\.([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*\),plan:[A-Za-z_$][\w$]*\}/g;

  const inlinedMatch = Array.from(original.matchAll(reInlined));
  const oldMatch = Array.from(original.matchAll(reOld));

  if (inlinedMatch.length > 0) {
    // New inlined pattern
    const m = inlinedMatch[0];
    const resultsVar = m[1];
    const hydratedVar = m[2];
    const okFnVar = m[3];
    const formatterVar = m[4];
    const diffFnVar = m[5];
    const beforeVar = m[6];
    const errFnVar = m[7];

    const insertion = buildTaskFailuresSummarySnippet({
      resultsVar,
      errorFnVar: errFnVar,
      textVar: "__byok_text",
      planVar: hydratedVar
    });

    // Replace the inlined return with: extract text var, insert error check, then return
    const oldReturn = `return ${hydratedVar}?{...${okFnVar}(${formatterVar}.formatBulkUpdateResponse(${diffFnVar}(${beforeVar},${hydratedVar}))),plan:${hydratedVar}}:${errFnVar}`;
    const oldReturnIdx = m[0].lastIndexOf("return " + hydratedVar + "?");
    const oldReturnStr = m[0].substring(oldReturnIdx);

    const newReturn = `let __byok_text=${formatterVar}.formatBulkUpdateResponse(${diffFnVar}(${beforeVar},${hydratedVar}));${insertion}return ${hydratedVar}?{...${okFnVar}(__byok_text),plan:${hydratedVar}}:${errFnVar}`;

    // Find the return tail in original and replace
    const returnTailRe = new RegExp(
      "return\\s+" + escapeRegExp(hydratedVar) + "\\?\\{\\.\\.\\." + escapeRegExp(okFnVar) + "\\(" +
      escapeRegExp(formatterVar) + "\\.formatBulkUpdateResponse\\(" + escapeRegExp(diffFnVar) + "\\(" +
      escapeRegExp(beforeVar) + "," + escapeRegExp(hydratedVar) + "\\)\\)\\),plan:" +
      escapeRegExp(hydratedVar) + "\\}:" + escapeRegExp(errFnVar) + "\\([^)]*\\)"
    );
    const tailMatch = next.match(returnTailRe);
    if (!tailMatch) throw new Error("tasklist add_tasks errors: inlined return tail not found");

    const newTail = `let __byok_text=${formatterVar}.formatBulkUpdateResponse(${diffFnVar}(${beforeVar},${hydratedVar}));${insertion}return ${hydratedVar}?{...${okFnVar}(__byok_text),plan:${hydratedVar}}:${errFnVar}(${tailMatch[0].match(/:([A-Za-z_$][\w$]*)\(([^)]*)\)$/)[2]})`;
    next = next.replace(tailMatch[0], newTail);

  } else if (oldMatch.length > 0) {
    // Old separate-let pattern (backward compat)
    const m = oldMatch[0];
    const resultsVar = m[1], textVar = m[2], formatterVar = m[3];
    const diffFnVar = m[4], hydratedVar = m[5], okFnVar = m[6];
    const errFnMatch = m[0].match(/return ([A-Za-z_$][\w$]*)\("No (?:root task|task list) found/);
    const errFnVar = errFnMatch ? errFnMatch[1] : "et";

    const oldTailRe = new RegExp(
      "let\\s+" + textVar + "=" + formatterVar + "\\.formatBulkUpdateResponse\\(" +
      diffFnVar + "\\(o," + hydratedVar + "\\)\\);[\\s\\S]*?return\\s*\\{\\.\\.\\."
      + okFnVar + "\\(" + textVar + "\\),plan:" + hydratedVar + "\\}"
    );
    const tailM = m[0].match(oldTailRe);
    if (!tailM) throw new Error("tasklist add_tasks errors: old tail not found");

    const insertion = buildTaskFailuresSummarySnippet({ resultsVar, errorFnVar: errFnVar, textVar, planVar: hydratedVar });
    const newTail = `let ${textVar}=${formatterVar}.formatBulkUpdateResponse(${diffFnVar}(o,${hydratedVar}));${insertion}return{...${okFnVar}(${textVar}),plan:${hydratedVar}}`;
    next = next.replace(tailM[0], newTail);

  } else {
    throw new Error("tasklist add_tasks errors: handleBatchCreation needle not found (upstream may have changed)");
  }

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
