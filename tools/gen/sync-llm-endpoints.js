#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { LLM_ENDPOINT_SPECS } = require("../report/llm-endpoints-spec");

function die(msg) {
  console.error(`[sync-llm-endpoints] ERROR: ${String(msg || "unknown error")}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[sync-llm-endpoints] ${String(msg || "")}`);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, txt) {
  fs.writeFileSync(filePath, txt, "utf8");
}

function parseArgs(argv) {
  const out = { write: false, check: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") out.write = true;
    else if (a === "--check") out.check = true;
  }
  if (!out.write && !out.check) out.check = true;
  if (out.write && out.check) die("use either --write or --check");
  return out;
}

function assert(cond, msg) {
  if (!cond) die(msg);
}

function replaceAndAssertMatch(src, re, replacement, label) {
  const s = String(src ?? "");
  assert(re.test(s), `missing pattern (${label || "unknown"})`);
  return s.replace(re, replacement);
}

function replaceBetweenMarkers(src, startMarker, endMarker, newInner) {
  const s = String(src ?? "");
  const start = s.indexOf(startMarker);
  const end = s.indexOf(endMarker);
  assert(start >= 0, `start marker not found: ${startMarker}`);
  assert(end >= 0, `end marker not found: ${endMarker}`);
  assert(end > start, `markers out of order: ${startMarker}`);

  const before = s.slice(0, start + startMarker.length);
  const endLineStart = s.lastIndexOf("\n", end);
  const afterStart = endLineStart >= 0 ? endLineStart + 1 : end;
  const after = s.slice(afterStart);

  const inner = String(newInner ?? "").replace(/\s+$/g, "");
  return `${before}\n${inner}\n${after}`;
}

function indentOfMarkerLine(src, marker) {
  const s = String(src ?? "");
  const idx = s.indexOf(marker);
  assert(idx >= 0, `marker not found for indent: ${marker}`);
  const lineStart = s.lastIndexOf("\n", idx);
  const prefix = s.slice(lineStart + 1, idx);
  const m = prefix.match(/^[\t ]*/);
  return m ? m[0] : "";
}

function validateSpecs(specs) {
  const list = Array.isArray(specs) ? specs : [];
  assert(list.length > 0, "LLM_ENDPOINT_SPECS empty");

  const endpoints = new Set();
  for (const spec of list) {
    assert(spec && typeof spec === "object" && !Array.isArray(spec), "spec not object");
    assert(typeof spec.endpoint === "string" && spec.endpoint.startsWith("/"), `invalid endpoint: ${String(spec.endpoint)}`);
    assert(spec.kind === "callApi" || spec.kind === "callApiStream", `invalid kind for ${spec.endpoint}: ${String(spec.kind)}`);
    assert(typeof spec.meaning === "string" && spec.meaning.trim(), `missing meaning for ${spec.endpoint}`);
    assert(!endpoints.has(spec.endpoint), `duplicate endpoint: ${spec.endpoint}`);
    endpoints.add(spec.endpoint);
  }
  return list;
}

function formatEndpointListMd(endpoints) {
  const xs = Array.isArray(endpoints) ? endpoints : [];
  return xs.map((ep) => `\`${ep}\``).join("、") || "-";
}

function generateDocsBlock(specs) {
  const callApi = specs.filter((s) => s.kind === "callApi").map((s) => s.endpoint);
  const callApiStream = specs.filter((s) => s.kind === "callApiStream").map((s) => s.endpoint);
  return [
    `- \`callApi\`（${callApi.length}）：${formatEndpointListMd(callApi)}`,
    `- \`callApiStream\`（${callApiStream.length}）：${formatEndpointListMd(callApiStream)}`
  ].join("\n");
}

function generateUiEndpointsBlock(specs, indent) {
  const xs = specs.map((s) => s.endpoint);
  return xs
    .map((ep, idx) => {
      const comma = idx === xs.length - 1 ? "" : ",";
      return `${indent}${JSON.stringify(ep)}${comma}`;
    })
    .join("\n");
}

function generateUiMeaningsBlock(specs, indent) {
  return specs
    .map((s) => `${indent}${JSON.stringify(s.endpoint)}: ${JSON.stringify(s.meaning)},`)
    .join("\n");
}

function generateDefaultConfigRoutingRulesBlock(specs, indent) {
  return specs
    .map((s) => `${indent}${JSON.stringify(s.endpoint)}: { mode: "byok" },`)
    .join("\n");
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = path.resolve(__dirname, "../..");

  const specs = validateSpecs(LLM_ENDPOINT_SPECS);
  const llmCount = specs.length;
  const officialChatSpecs = specs.filter((s) => s.endpoint === "/chat" || s.endpoint === "/chat-stream");
  const officialExecutionSpecs = specs.filter((s) => s.endpoint !== "/get-models");

  const docsPath = path.join(repoRoot, "docs", "ENDPOINTS.md");
  const uiPath = path.join(repoRoot, "payload", "extension", "out", "byok", "ui", "config-panel", "webview", "render", "index.js");
  const defaultCfgPath = path.join(repoRoot, "payload", "extension", "out", "byok", "config", "default-config.js");
  const officialDelegationPath = path.join(repoRoot, "payload", "extension", "out", "byok", "core", "official-delegation.js");

  let docs = readText(docsPath);
  docs = replaceAndAssertMatch(docs, /^(# ENDPOINTS：\s*\d+\s*\/\s*)\d+/m, `$1${llmCount}`, "docs header LLM count");
  docs = replaceAndAssertMatch(
    docs,
    /\*\*\d+\s*个 LLM 数据面端点\*\*/,
    `**${llmCount} 个 LLM 数据面端点**`,
    "docs bold LLM endpoint count"
  );
  docs = replaceAndAssertMatch(
    docs,
    /^(##\s*)\d+(\s*个 LLM 数据面)/m,
    `$1${llmCount}$2`,
    "docs section LLM endpoint count"
  );
  docs = replaceBetweenMarkers(
    docs,
    "<!-- BEGIN GENERATED: LLM_ENDPOINTS -->",
    "<!-- END GENERATED: LLM_ENDPOINTS -->",
    generateDocsBlock(specs)
  );

  let ui = readText(uiPath);
  ui = replaceAndAssertMatch(ui, /label:\s*"LLM 数据面（\d+）"/, `label: "LLM 数据面（${llmCount}）"`, "ui llm group label");

  const epIndent = indentOfMarkerLine(ui, "/* BEGIN GENERATED: LLM_ENDPOINTS */");
  ui = replaceBetweenMarkers(
    ui,
    "/* BEGIN GENERATED: LLM_ENDPOINTS */",
    "/* END GENERATED: LLM_ENDPOINTS */",
    generateUiEndpointsBlock(specs, epIndent)
  );

  const meaningIndent = indentOfMarkerLine(ui, "/* BEGIN GENERATED: LLM_ENDPOINT_MEANINGS */");
  ui = replaceBetweenMarkers(
    ui,
    "/* BEGIN GENERATED: LLM_ENDPOINT_MEANINGS */",
    "/* END GENERATED: LLM_ENDPOINT_MEANINGS */",
    generateUiMeaningsBlock(specs, meaningIndent)
  );

  let defaultCfg = readText(defaultCfgPath);
  const defaultIndent = indentOfMarkerLine(defaultCfg, "/* BEGIN GENERATED: DEFAULT_LLM_ROUTING_RULES */");
  defaultCfg = replaceBetweenMarkers(
    defaultCfg,
    "/* BEGIN GENERATED: DEFAULT_LLM_ROUTING_RULES */",
    "/* END GENERATED: DEFAULT_LLM_ROUTING_RULES */",
    generateDefaultConfigRoutingRulesBlock(specs, defaultIndent)
  );

  let officialDelegation = readText(officialDelegationPath);
  const chatIndent = indentOfMarkerLine(officialDelegation, "/* BEGIN GENERATED: OFFICIAL_CHAT_ENDPOINTS */");
  officialDelegation = replaceBetweenMarkers(
    officialDelegation,
    "/* BEGIN GENERATED: OFFICIAL_CHAT_ENDPOINTS */",
    "/* END GENERATED: OFFICIAL_CHAT_ENDPOINTS */",
    generateUiEndpointsBlock(officialChatSpecs, chatIndent)
  );
  const execIndent = indentOfMarkerLine(officialDelegation, "/* BEGIN GENERATED: OFFICIAL_EXECUTION_DELEGATION_ENDPOINTS */");
  officialDelegation = replaceBetweenMarkers(
    officialDelegation,
    "/* BEGIN GENERATED: OFFICIAL_EXECUTION_DELEGATION_ENDPOINTS */",
    "/* END GENERATED: OFFICIAL_EXECUTION_DELEGATION_ENDPOINTS */",
    generateUiEndpointsBlock(officialExecutionSpecs, execIndent)
  );

  if (args.check) {
    const docsNow = readText(docsPath);
    const uiNow = readText(uiPath);
    const bad = [];
    if (docsNow !== docs) bad.push(path.relative(repoRoot, docsPath));
    if (uiNow !== ui) bad.push(path.relative(repoRoot, uiPath));
    if (readText(defaultCfgPath) !== defaultCfg) bad.push(path.relative(repoRoot, defaultCfgPath));
    if (readText(officialDelegationPath) !== officialDelegation) bad.push(path.relative(repoRoot, officialDelegationPath));
    if (bad.length) {
      console.error(`[sync-llm-endpoints] OUTDATED (run: node tools/gen/sync-llm-endpoints.js --write)`);
      for (const p of bad) console.error(`- ${p}`);
      process.exit(2);
    }
    ok("OK");
    return;
  }

  if (args.write) {
    const docsBefore = readText(docsPath);
    const uiBefore = readText(uiPath);
    const defaultCfgBefore = readText(defaultCfgPath);
    if (docsBefore !== docs) writeText(docsPath, docs);
    if (uiBefore !== ui) writeText(uiPath, ui);
    if (defaultCfgBefore !== defaultCfg) writeText(defaultCfgPath, defaultCfg);
    if (readText(officialDelegationPath) !== officialDelegation) writeText(officialDelegationPath, officialDelegation);
    ok("wrote updated files");
    return;
  }

  die("unreachable");
}

main();
