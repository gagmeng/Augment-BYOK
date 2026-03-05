#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { ensureMarker, replaceOnceRegex } = require("../lib/patch");

const MARKER = "__augment_byok_webview_history_summary_node_slim_v1";

function patchExtensionClientContextAsset(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  // 上游 useHistorySummaryNew 会把 {history_end: tail exchanges(with nodes)} 存进 request_nodes 的 HISTORY_SUMMARY 节点。
  // 该节点体积巨大，后续“Editable History / 编辑历史对话”等路径可能对 request_nodes 做 JSON.stringify/clone，导致内存爆炸→VSIX 崩溃。
  //
  // 修复策略：仍然生成同样的 summary payload（C），但存入 state 的节点改为 TEXT，并把 message_template 填充后的字符串写入 text_node.content。
  // 这样：语义保持（模型仍拿到同样的 supervisor prompt），同时避免把 history_end 的巨型结构长期挂在 state 上。
  let out = original;

  // 兼容上游小版本变更：不强依赖整段变量名（N/F/aS/rS 等），只替换“把 payload C 存入 HISTORY_SUMMARY 节点”的那一小段。
  // 目标：U={id:0,type:ENUM.HISTORY_SUMMARY,history_summary_node:C} -> U={id:0,type:ENUM.TEXT,text_node:{content:RENDERFN(C)}}
  //
  // NOTE: RENDERFN（曾叫 k3，后改为 wK 等）是上游内部函数：把 summary payload 按 message_template 渲染为最终字符串。
  //       通过 `function FUNC(e){const t=e.history_end.map(` 模式动态定位，避免硬编码。

  // Step 1: 动态查找渲染函数名（唯一匹配 e.history_end.map 的函数）
  const renderFnMatches = Array.from(out.matchAll(/function ([A-Za-z_$][0-9A-Za-z_$]*)\(e\)\{const t=e\.history_end\.map\(/g));
  if (!renderFnMatches.length) throw new Error("extension-client-context history summary render function not found (upstream may have changed)");
  if (renderFnMatches.length > 1) throw new Error("extension-client-context history summary render function matched multiple times (refuse to patch)");
  const renderFnName = renderFnMatches[0][1];

  // Step 2: 替换 HISTORY_SUMMARY 节点为 TEXT 节点
  const summaryNodeRe = /\{id:0,type:([A-Za-z_$][0-9A-Za-z_$]*)\.HISTORY_SUMMARY,history_summary_node:([A-Za-z_$][0-9A-Za-z_$]*)\}/g;
  out = replaceOnceRegex(
    out,
    summaryNodeRe,
    (m) => `{id:0,type:${m[1]}.TEXT,text_node:{content:${renderFnName}(${m[2]})}}`,
    "extension-client-context HISTORY_SUMMARY node slimming"
  );

  out = ensureMarker(out, MARKER);
  fs.writeFileSync(filePath, out, "utf8");
  return { changed: true, reason: "patched" };
}

function patchWebviewHistorySummaryNode(extensionDir) {
  const extDir = path.resolve(String(extensionDir || ""));
  if (!extDir || extDir === path.parse(extDir).root) throw new Error("patchWebviewHistorySummaryNode: invalid extensionDir");

  const assetsDir = path.join(extDir, "common-webviews", "assets");
  if (!fs.existsSync(assetsDir)) throw new Error(`webview assets dir missing: ${assetsDir}`);

  const candidates = fs
    .readdirSync(assetsDir)
    .filter((name) => typeof name === "string" && name.startsWith("extension-client-context-") && name.endsWith(".js"))
    .map((name) => path.join(assetsDir, name));

  if (!candidates.length) throw new Error("extension-client-context asset not found (upstream may have changed)");

  const results = [];
  for (const filePath of candidates) results.push({ filePath, ...patchExtensionClientContextAsset(filePath) });
  return { changed: results.some((r) => r.changed), results };
}

module.exports = { patchWebviewHistorySummaryNode };

if (require.main === module) {
  const extensionDir = process.argv[2];
  if (!extensionDir) {
    console.error(`usage: ${path.basename(process.argv[1])} <extensionDir>`);
    process.exit(2);
  }
  patchWebviewHistorySummaryNode(extensionDir);
}
