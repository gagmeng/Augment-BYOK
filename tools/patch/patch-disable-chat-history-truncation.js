#!/usr/bin/env node
"use strict";

const path = require("path");

const { findMatchingParen, findStatementTerminatorIndex } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");

const MARKER = "__augment_byok_disable_chat_history_truncation_v1";

function makeRuntimeEnabledGuard({ mode } = {}) {
  const kind = mode === "field" ? "field" : "method";
  if (kind === "field") {
    return (
      `((__byok_prev)=>{` +
      `let __byok_state;` +
      `try{__byok_state=require("./byok/config/state")}catch{}` +
      `return function(){` +
      `try{if(__byok_state&&__byok_state.state&&__byok_state.state.runtimeEnabled===true)return arguments[0];}catch{};` +
      `return __byok_prev.apply(this,arguments);` +
      `}` +
      `})`
    );
  }
  return (
    `try{` +
    `const __byok_state=require("./byok/config/state");` +
    `if(__byok_state&&__byok_state.state&&__byok_state.state.runtimeEnabled===true)return arguments[0];` +
    `}catch{};`
  );
}

function findLimitChatHistoryFieldRanges(src) {
  const s = String(src || "");
  const ranges = [];
  const re = /\blimitChatHistory\s*=(?!=)/g;
  for (const m of s.matchAll(re)) {
    const start = Number(m.index);
    if (!Number.isFinite(start) || start < 0) continue;
    const rhsStart = start + m[0].length;
    const termIdx = findStatementTerminatorIndex(s, rhsStart, { allowComma: true, label: "statement terminator after limitChatHistory assignment" });
    ranges.push({ start, rhsStart, termIdx });
  }
  return ranges;
}

function findLimitChatHistoryMethodOpenBraceIndexes(src) {
  const s = String(src || "");
  const out = [];
  const re = /\blimitChatHistory\s*\(/g;
  for (const m of s.matchAll(re)) {
    const start = Number(m.index);
    if (!Number.isFinite(start) || start < 0) continue;
    if (start > 0 && s[start - 1] === ".") continue;

    const openParen = s.indexOf("(", start);
    if (openParen < 0) continue;
    const closeParen = findMatchingParen(s, openParen);
    if (closeParen < 0) continue;

    let i = closeParen + 1;
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== "{") continue;
    out.push(i);
  }
  return out;
}

function patchDisableChatHistoryTruncation(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  let out = original;

  const ranges = findLimitChatHistoryFieldRanges(out);
  if (ranges.length) {
    const sorted = ranges.slice().sort((a, b) => b.start - a.start);
    for (const range of sorted) {
      const rhs = out.slice(range.rhsStart, range.termIdx);
      if (!rhs.trim()) throw new Error("unexpected empty limitChatHistory assignment");

      const injectedRhs = `${makeRuntimeEnabledGuard({ mode: "field" })}(${rhs})`;

      out = out.slice(0, range.rhsStart) + injectedRhs + out.slice(range.termIdx);
    }

    savePatchText(filePath, out, { marker: MARKER });
    return { changed: true, reason: "patched", patchedFieldAssignments: ranges.length };
  }

  const methodOpenBraces = findLimitChatHistoryMethodOpenBraceIndexes(out);
  if (!methodOpenBraces.length) throw new Error("failed to locate ChatModel.limitChatHistory field assignment or method definition");

  const injection = `${makeRuntimeEnabledGuard({ mode: "method" })}`;

  const sorted = methodOpenBraces.slice().sort((a, b) => b - a);
  for (const openBraceIdx of sorted) out = out.slice(0, openBraceIdx + 1) + injection + out.slice(openBraceIdx + 1);

  savePatchText(filePath, out, { marker: MARKER });
  return { changed: true, reason: "patched", patchedMethodDefinitions: methodOpenBraces.length };
}

module.exports = { patchDisableChatHistoryTruncation };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchDisableChatHistoryTruncation(filePath);
}
