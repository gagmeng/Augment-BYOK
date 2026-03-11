#!/usr/bin/env node
"use strict";

const path = require("path");

const { replaceOnceRegex } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");
const { requireCapture, buildEnsureRootSnippet } = require("./tasklist-common");

const MARKER = "__augment_byok_tasklist_auto_root_patched_v1";

function patchTasklistAutoRoot(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  let next = original;

  // Tasklist tools require a conversation-scoped root task list uuid.
  // Upstream v0.801+ uses getOrCreateTaskListId which auto-creates, but still fails if conversationId is missing.
  // Patch: ensure root task list exists even without conversationId by creating a fallback.
  // 1) view_tasklist - match new upstream pattern with getOrCreateTaskListId
  next = replaceOnceRegex(
    next,
    /async call\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{try\{let\s+([A-Za-z_$][\w$]*)=await this\._taskManager\.getOrCreateTaskListId\(\6\);if\(!\7\)return\s*([A-Za-z_$][\w$]*)\("No task list found\.\s*\[TL001\]"\);/g,
    (m) => {
      const label = "tasklist auto root: view_tasklist";
      const p1 = requireCapture(m, 1, `${label} p1`);
      const p2 = requireCapture(m, 2, `${label} p2`);
      const p3 = requireCapture(m, 3, `${label} p3`);
      const p4 = requireCapture(m, 4, `${label} p4`);
      const p5 = requireCapture(m, 5, `${label} p5`);
      const convVar = requireCapture(m, 6, `${label} conversationId`);
      const rootVar = requireCapture(m, 7, `${label} rootVar`);
      const errFnVar = requireCapture(m, 8, `${label} errFn`);
      // Patch: create task list even without conversationId
      return `async call(${p1},${p2},${p3},${p4},${p5},${convVar}){try{let ${rootVar}=await this._taskManager.getOrCreateTaskListId(${convVar});if(!${rootVar}&&typeof this._taskManager.createNewTaskList==="function"){${rootVar}=await this._taskManager.createNewTaskList(${convVar}||"")}if(!${rootVar})return ${errFnVar}("No task list found. [TL001]");`;
    },
    "tasklist auto root: view_tasklist"
  );

  // 2) update_tasks: handleBatchUpdate - match new upstream pattern with getOrCreateTaskListId
  next = replaceOnceRegex(
    next,
    /async handleBatchUpdate\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{let\s+([A-Za-z_$][\w$]*)=await this\._taskManager\.getOrCreateTaskListId\(\1\);if\(!\3\)return\s*([A-Za-z_$][\w$]*)\("No task list found\.\s*\[TL002\]"\);/g,
    (m) => {
      const label = "tasklist auto root: update_tasks";
      const convVar = requireCapture(m, 1, `${label} conversationId`);
      const tasksVar = requireCapture(m, 2, `${label} tasks`);
      const rootVar = requireCapture(m, 3, `${label} rootVar`);
      const errFnVar = requireCapture(m, 4, `${label} errFn`);
      return `async handleBatchUpdate(${convVar},${tasksVar}){let ${rootVar}=await this._taskManager.getOrCreateTaskListId(${convVar});if(!${rootVar}&&typeof this._taskManager.createNewTaskList==="function"){${rootVar}=await this._taskManager.createNewTaskList(${convVar}||"")}if(!${rootVar})return ${errFnVar}("No task list found. [TL002]");`;
    },
    "tasklist auto root: update_tasks"
  );

  // 3) add_tasks: handleBatchCreation - match new upstream pattern with getOrCreateTaskListId
  next = replaceOnceRegex(
    next,
    /async handleBatchCreation\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{let\s+([A-Za-z_$][\w$]*)=await this\._taskManager\.getOrCreateTaskListId\(\1\);if\(!\3\)return\s*([A-Za-z_$][\w$]*)\("No task list found\.\s*\[TL005\]"\);/g,
    (m) => {
      const label = "tasklist auto root: add_tasks";
      const convVar = requireCapture(m, 1, `${label} conversationId`);
      const tasksVar = requireCapture(m, 2, `${label} tasks`);
      const rootVar = requireCapture(m, 3, `${label} rootVar`);
      const errFnVar = requireCapture(m, 4, `${label} errFn`);
      return `async handleBatchCreation(${convVar},${tasksVar}){let ${rootVar}=await this._taskManager.getOrCreateTaskListId(${convVar});if(!${rootVar}&&typeof this._taskManager.createNewTaskList==="function"){${rootVar}=await this._taskManager.createNewTaskList(${convVar}||"")}if(!${rootVar})return ${errFnVar}("No task list found. [TL005]");`;
    },
    "tasklist auto root: add_tasks"
  );

  // 4) reorganize_tasklist - match new upstream pattern with getOrCreateTaskListId
  next = replaceOnceRegex(
    next,
    /let\s+([A-Za-z_$][\w$]*)=r\.markdown;if\(!\1\)return\s*([A-Za-z_$][\w$]*)\("No markdown provided\."\);let\s+([A-Za-z_$][\w$]*)=await this\._taskManager\.getOrCreateTaskListId\(([A-Za-z_$][\w$]*)\);if\(!\3\)return\s*\2\("No task list found\.\s*\[TL003\]"\);/g,
    (m) => {
      const label = "tasklist auto root: reorganize_tasklist";
      const markdownVar = requireCapture(m, 1, `${label} markdownVar`);
      const errFnVar = requireCapture(m, 2, `${label} errFn`);
      const rootVar = requireCapture(m, 3, `${label} rootVar`);
      const convVar = requireCapture(m, 4, `${label} conversationId`);
      return (
        `let ${markdownVar}=r.markdown;if(!${markdownVar})return ${errFnVar}("No markdown provided.");let ${rootVar}=await this._taskManager.getOrCreateTaskListId(${convVar});if(!${rootVar}&&typeof this._taskManager.createNewTaskList==="function"){${rootVar}=await this._taskManager.createNewTaskList(${convVar}||"")}if(!${rootVar})return ${errFnVar}("No task list found. [TL003]");`
      );
    },
    "tasklist auto root: reorganize_tasklist"
  );

  savePatchText(filePath, next, { marker: MARKER });
  return { changed: true, reason: "patched" };
}

module.exports = { patchTasklistAutoRoot };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchTasklistAutoRoot(filePath);
}
