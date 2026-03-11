#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { LLM_ENDPOINT_SPECS } = require("../report/llm-endpoints-spec");

const OFFICIAL_ASSEMBLY_ENDPOINTS = Object.freeze(
  LLM_ENDPOINT_SPECS.map((s) => String(s?.endpoint || ""))
    .filter((ep) => ep.startsWith("/") && ep !== "/get-models")
    .sort()
);
const OFFICIAL_ASSEMBLY_ENDPOINT_SET = new Set(OFFICIAL_ASSEMBLY_ENDPOINTS);
const OFFICIAL_CHAT_ENDPOINT_SET = new Set(["/chat", "/chat-stream"]);

function parseArgs(argv) {
  const out = { strict: false, requireAll: false, json: false, files: [] };
  for (const arg of argv.slice(2)) {
    if (arg === "--strict") out.strict = true;
    else if (arg === "--require-all") out.requireAll = true;
    else if (arg === "--json") out.json = true;
    else out.files.push(arg);
  }
  return out;
}

function inc(map, key, n = 1) {
  const k = String(key || "");
  if (!k) return;
  map.set(k, (map.get(k) || 0) + n);
}

function mapToObject(map) {
  const out = {};
  for (const [k, v] of map.entries()) out[k] = v;
  return out;
}

function readLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return String(fs.readFileSync(filePath, "utf8")).split(/\r?\n/);
  } catch {
    return [];
  }
}

function analyze(lines) {
  const routeByokByEndpoint = new Map();
  const routeByKindEndpoint = new Map();

  const chatDelegatedByEndpoint = new Map();
  const chatMissByEndpoint = new Map();
  const textDelegatedByEndpoint = new Map();
  const textMissByEndpoint = new Map();

  let byokRouteTotal = 0;
  let chatHit = 0;
  let chatMiss = 0;
  let chatFail = 0;
  let textHit = 0;
  let textMiss = 0;
  let textFail = 0;

  for (const line of lines) {
    const route = line.match(/\[(callApi|callApiStream)\].*\bep=(\/[^\s]+)\b.*\bmode=byok\b/i);
    if (route) {
      const kind = route[1];
      const ep = route[2];
      if (!OFFICIAL_ASSEMBLY_ENDPOINT_SET.has(ep)) continue;
      inc(routeByokByEndpoint, ep);
      inc(routeByKindEndpoint, `${kind}\t${ep}`);
      byokRouteTotal += 1;
    }

    const chatDelegated = line.match(/official assembler delegated:\s+ep=(\/[^\s]+)\s+source=/i);
    if (chatDelegated) inc(chatDelegatedByEndpoint, chatDelegated[1]);

    const chatDelegatedMiss = line.match(/official assembler delegated miss:\s+ep=(\/[^\s]+)\s+reason=/i);
    if (chatDelegatedMiss) inc(chatMissByEndpoint, chatDelegatedMiss[1]);

    const textDelegated = line.match(/official text assembler delegated:\s+ep=(\/[^\s]+)\s+source=/i);
    if (textDelegated) inc(textDelegatedByEndpoint, textDelegated[1]);

    const textDelegatedMiss = line.match(/official text assembler delegated miss:\s+ep=(\/[^\s]+)\s+reason=/i);
    if (textDelegatedMiss) inc(textMissByEndpoint, textDelegatedMiss[1]);

    if (line.includes("delegated official assembler hit:")) chatHit += 1;
    if (line.includes("official assembler delegated miss:")) chatMiss += 1;
    if (line.includes("official assembler delegation failed:")) chatFail += 1;

    if (line.includes("delegated official text assembler hit:")) textHit += 1;
    if (line.includes("official text assembler delegated miss:")) textMiss += 1;
    if (line.includes("official text assembler delegation failed:")) textFail += 1;
  }

  const perEndpoint = [];
  for (const ep of OFFICIAL_ASSEMBLY_ENDPOINTS) {
    const routeCount = routeByokByEndpoint.get(ep) || 0;
    const isChat = OFFICIAL_CHAT_ENDPOINT_SET.has(ep);
    const delegated = isChat ? chatDelegatedByEndpoint.get(ep) || 0 : textDelegatedByEndpoint.get(ep) || 0;
    const miss = isChat ? chatMissByEndpoint.get(ep) || 0 : textMissByEndpoint.get(ep) || 0;
    perEndpoint.push({
      endpoint: ep,
      isChat,
      routeByokCount: routeCount,
      delegatedCount: delegated,
      missCount: miss,
      coverage: routeCount > 0 ? delegated / routeCount : 0
    });
  }
  perEndpoint.sort(
    (a, b) =>
      b.routeByokCount - a.routeByokCount ||
      b.delegatedCount - a.delegatedCount ||
      b.missCount - a.missCount ||
      a.endpoint.localeCompare(b.endpoint)
  );

  const summary = {
    routeByokByEndpoint: mapToObject(routeByokByEndpoint),
    routeByKindEndpoint: mapToObject(routeByKindEndpoint),
    chatDelegatedByEndpoint: mapToObject(chatDelegatedByEndpoint),
    chatMissByEndpoint: mapToObject(chatMissByEndpoint),
    textDelegatedByEndpoint: mapToObject(textDelegatedByEndpoint),
    textMissByEndpoint: mapToObject(textMissByEndpoint),
    byokRouteTotal,
    chatHit,
    chatMiss,
    chatFail,
    textHit,
    textMiss,
    textFail,
    perEndpoint
  };
  return summary;
}

function printTable(summary) {
  const rows = summary.perEndpoint;
  console.log("Endpoint\tRoute(mode=byok)\tDelegated\tMiss\tCoverage");
  for (const row of rows) {
    console.log(
      `${row.endpoint}\t${row.routeByokCount}\t${row.delegatedCount}\t${row.missCount}\t${(row.coverage * 100).toFixed(1)}%`
    );
  }

  console.log("");
  if (!Number(summary.byokRouteTotal) || summary.byokRouteTotal <= 0) {
    console.log("Note: no [callApi/callApiStream] route logs found (mode=byok).");
  }
  console.log(
    `Chat: hit=${summary.chatHit} miss=${summary.chatMiss} fail=${summary.chatFail} | Text: hit=${summary.textHit} miss=${summary.textMiss} fail=${summary.textFail}`
  );
}

function hasStrictFailure(summary, { requireAll = false } = {}) {
  if (!Number(summary.byokRouteTotal) || summary.byokRouteTotal <= 0) return true;
  if (summary.chatFail > 0 || summary.textFail > 0) return true;
  if (summary.chatMiss > 0 || summary.textMiss > 0) return true;
  for (const row of summary.perEndpoint) {
    if (row.routeByokCount > 0 && row.missCount > 0) return true;
    if (row.routeByokCount > 0 && row.delegatedCount < row.routeByokCount) return true;
    if (requireAll && row.routeByokCount === 0) return true;
  }
  return false;
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  const files = args.files.length ? args.files : ["webview.log", "vscode.log"];
  const absFiles = files.map((f) => path.resolve(String(f)));

  const allLines = [];
  let nonEmptyFiles = 0;
  for (const file of absFiles) {
    const lines = readLines(file);
    if (!lines.length) {
      console.error(`[official-delegation-audit] warn: empty or missing log file: ${file}`);
      continue;
    }
    nonEmptyFiles += 1;
    allLines.push(...lines);
  }

  const summary = analyze(allLines);
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printTable(summary);
  }

  if (args.strict && (nonEmptyFiles === 0 || hasStrictFailure(summary, { requireAll: args.requireAll }))) {
    console.error("[official-delegation-audit] strict check failed");
    process.exit(1);
  }
}

module.exports = {
  OFFICIAL_ASSEMBLY_ENDPOINTS,
  analyze,
  hasStrictFailure,
  parseArgs,
  readLines,
  main
};

if (require.main === module) main();
