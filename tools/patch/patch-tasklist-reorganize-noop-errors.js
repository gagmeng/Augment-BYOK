#!/usr/bin/env node
"use strict";

const path = require("path");

const { replaceOnceRegex } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");
const { requireCapture, buildTasklistNoopGuardSnippet } = require("./tasklist-common");

const MARKER = "__augment_byok_tasklist_reorganize_noop_errors_patched_v1";

function patchTasklistReorganizeNoopErrors(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  let next = original;

  next = replaceOnceRegex(
    next,
    /(let\s+([A-Za-z_$][\w$]*)=r\.markdown;if\(!\2\)return\s+([A-Za-z_$][\w$]*)\("No markdown provided\."\);[\s\S]*?)(if\(!([A-Za-z_$][\w$]*)\)return\s+\3\("Failed to retrieve updated task tree(?: after reorganization)?\."\);\s*let\s+([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.formatBulkUpdateResponse\(([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\);\s*return\s*((?:[A-Za-z_$][\w$]*&&[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\),)?)\{\.\.\.([A-Za-z_$][\w$]*)\(\6\),plan:\5\})/g,
    (m) => {
      const label = "tasklist reorganize noop errors";
      const prefixBlock = requireCapture(m, 1, `${label} prefixBlock`);
      const errFnVar = requireCapture(m, 3, `${label} errFnVar`);
      const planVar = requireCapture(m, 5, `${label} planVar`);
      const textVar = requireCapture(m, 6, `${label} textVar`);
      const formatterVar = requireCapture(m, 7, `${label} formatterVar`);
      const diffFnVar = requireCapture(m, 8, `${label} diffFnVar`);
      const beforeVar = requireCapture(m, 9, `${label} beforeVar`);
      const afterVar = requireCapture(m, 10, `${label} afterVar`);
      const returnPrefix = String(m[11] || "");
      const okFnVar = requireCapture(m, 12, `${label} okFnVar`);

      return prefixBlock +
        buildTasklistNoopGuardSnippet({
          diffVar: "__byok_reorg_diff",
          diffFnVar,
          beforeVar,
          afterVar,
          errorFnVar: errFnVar,
          planVar,
          textVar,
          formatterVar,
          okFnVar,
          returnPrefix
        });
    },
    "tasklist reorganize noop errors: tail flow"
  );

  savePatchText(filePath, next, { marker: MARKER });
  return { changed: true, reason: "patched" };
}

module.exports = { patchTasklistReorganizeNoopErrors };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchTasklistReorganizeNoopErrors(filePath);
}
