#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { getArgValue, getBooleanArg } = require("../lib/cli-args");
const { readJson, writeText, ensureDir } = require("../lib/fs");
const { LLM_ENDPOINT_SPECS } = require("./llm-endpoints-spec");

function formatList(xs) {
  const arr = Array.isArray(xs) ? xs : [];
  return arr.length ? arr.join(", ") : "-";
}

function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  const analysisPath = path.resolve(repoRoot, getArgValue(process.argv, "--analysis") || ".cache/reports/upstream-analysis.json");
  const outPath = path.resolve(repoRoot, getArgValue(process.argv, "--out") || "dist/endpoint-coverage.report.md");
  const failFast = getBooleanArg(process.argv, "--fail-fast");

  if (!fs.existsSync(analysisPath)) throw new Error(`missing analysis json: ${path.relative(repoRoot, analysisPath)}`);
  const analysis = readJson(analysisPath);
  const endpointDetails = analysis?.endpointDetails && typeof analysis.endpointDetails === "object" ? analysis.endpointDetails : {};

  const errors = [];
  const rows = [];
  for (const spec of LLM_ENDPOINT_SPECS) {
    const d = endpointDetails[spec.endpoint];
    const callApi = Number(d?.callApi || 0);
    const callApiStream = Number(d?.callApiStream || 0);
    const expectedApi = spec.kind === "callApi" ? 1 : 0;
    const expectedStream = spec.kind === "callApiStream" ? 1 : 0;
    const okApi = expectedApi ? callApi > 0 : callApi === 0;
    const okStream = expectedStream ? callApiStream > 0 : callApiStream === 0;

    if (!d) errors.push(`missing endpoint in upstream: ${spec.endpoint}`);
    else if (!okApi || !okStream) {
      errors.push(`endpoint kind mismatch: ${spec.endpoint} expected=${spec.kind} got(callApi=${callApi}, callApiStream=${callApiStream})`);
    }

    rows.push({
      endpoint: spec.endpoint,
      kind: spec.kind,
      upstreamBackType: spec.upstreamBackType,
      inputKeys: formatList(spec.inputKeys),
      outputKeys: formatList(spec.outputKeys),
      byokImpl: spec.byokImpl
    });
  }

  const upstream = analysis?.upstream || {};
  const header = [
    "# LLM 端点覆盖矩阵（11）",
    "",
    `- upstream: ${String(upstream.publisher || "augment")}/${String(upstream.extension || "vscode-augment")}@${String(upstream.version || "unknown")}`,
    `- analysis: ${path.relative(repoRoot, analysisPath)}`,
    "",
    "## 概览（11×输入/输出形状）",
    "",
    "| endpoint | kind | upstream back type | input shape (keys) | output shape (keys) |",
    "|---|---|---|---|---|"
  ].join("\n");

  const lines = [header];
  for (const r of rows) {
    lines.push(`| \`${r.endpoint}\` | \`${r.kind}\` | \`${r.upstreamBackType}\` | ${r.inputKeys} | ${r.outputKeys} |`);
  }

  lines.push("", "## 实现映射（shim/protocol）", "");
  for (const r of rows) {
    lines.push(`### ${r.endpoint}`, `- kind: \`${r.kind}\``, `- upstream: \`${r.upstreamBackType}\``, `- byok: ${r.byokImpl}`, "");
  }

  if (errors.length) {
    lines.push("## 校验结果", "", "FAIL（上游 LLM 端点集合/调用类型发生变化）", "");
    for (const e of errors) lines.push(`- ${e}`);
  } else {
    lines.push("## 校验结果", "", "PASS（上游 LLM 端点集合与调用类型一致）", "");
  }

  ensureDir(path.dirname(outPath));
  writeText(outPath, lines.join("\n") + "\n");
  console.log(`[coverage] wrote ${path.relative(repoRoot, outPath)} (errors=${errors.length})`);

  if (errors.length && failFast) process.exit(2);
}

main();
