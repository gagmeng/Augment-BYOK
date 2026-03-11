"use strict";

const { normalizeEndpoint, normalizeString } = require("../../../infra/util");
const { normalizeBlobsMap, coerceBlobText, pickBestBlobName, listBlobKeys } = require("../../../core/blob-utils");
const { extractFirstDiagnosticPath, extractFirstDiagnosticLine } = require("../../../core/diagnostics-utils");
const { pickPath, pickInstruction, pickNumResults, pickBlobNameHint } = require("../../../core/next-edit/fields");
const { clampInt } = require("../../../core/number-utils");
const { normalizeNewlines } = require("../../../infra/text");
const { fmtSection, fmtCodeSection, fmtJsonSection, extractDirectives, buildSystem } = require("./prompt-utils");

function formatLineWindow(text, { focusLine = 0, radius = 40, maxChars = 12000 } = {}) {
  const src = typeof text === "string" ? text : "";
  if (!src) return "";
  const lines = normalizeNewlines(src).split("\n");
  if (!lines.length) return "";
  const center = clampInt(focusLine, { min: 0, max: Math.max(0, lines.length - 1) });
  const r = clampInt(radius, { min: 0, max: 200 });
  const start = clampInt(center - r, { min: 0, max: Math.max(0, lines.length - 1) });
  const end = clampInt(center + r, { min: start, max: Math.max(0, lines.length - 1) });
  const width = String(end).length;
  const out = [];
  for (let i = start; i <= end; i++) {
    const no = String(i).padStart(width, " ");
    out.push(`${no}: ${lines[i] ?? ""}`);
  }
  const joined = out.join("\n");
  if (joined.length <= maxChars) return joined;
  return joined.slice(0, Math.max(0, maxChars - 14)) + "\n…(truncated)";
}

function tryFromEndpointFieldsNextEditLoc(endpoint, rawBody) {
  const ep = normalizeEndpoint(endpoint);
  if (ep !== "/next_edit_loc") return null;

  const b = rawBody && typeof rawBody === "object" ? rawBody : {};
  const directives = extractDirectives(b);

  const instruction = pickInstruction(b) || "Propose where the next edit should occur.";
  const path = pickPath(b);
  const numResultsRaw = pickNumResults(b, { defaultValue: 0, max: 6 });
  const numResults = numResultsRaw > 0 ? numResultsRaw : null;
  const isSingleFileRaw = b.is_single_file ?? b.isSingleFile;
  const isSingleFile = typeof isSingleFileRaw === "boolean" ? isSingleFileRaw : null;

  const diagnostics = b.diagnostics;
  const recentChanges = b.recent_changes ?? b.recentChanges;
  const editEvents = b.edit_events ?? b.editEvents;
  const vcsChange = b.vcs_change ?? b.vcsChange;
  const blobs = normalizeBlobsMap(b.blobs);
  const blobKeys = listBlobKeys(blobs, { maxItems: 500 });
  const diagPath = extractFirstDiagnosticPath(diagnostics);
  const pathHint = path || diagPath;
  let primaryBlobName = pickBestBlobName({ blobs, blobNameHint: pickBlobNameHint(b), pathHint });
  if (!primaryBlobName && blobKeys.length) primaryBlobName = blobKeys[0];
  const primaryBlobText = primaryBlobName && blobs ? coerceBlobText(blobs[primaryBlobName]) : "";

  if (!normalizeString(instruction) && !pathHint && diagnostics == null && !blobKeys.length) return null;

  const system = buildSystem({
    purpose: "next_edit_loc",
    directives,
    outputConstraints:
      "Return ONLY valid JSON (no markdown).\n" +
      "Schema:\n" +
      "{\n" +
      "  \"candidate_locations\": [\n" +
      "    { \"path\": \"...\", \"start\": 0, \"stop\": 0 }\n" +
      "  ]\n" +
      "}\n" +
      "Rules:\n" +
      "- `start`/`stop` are 0-based line numbers (inclusive).\n" +
      "- Prefer locations backed by diagnostics/recent changes.\n" +
      "- If possible, choose `path` from provided blobs keys.\n" +
      "- Keep results minimal and focused."
  });

  const parts = [];
  if (instruction) parts.push(fmtSection("Instruction", instruction));
  if (pathHint) parts.push(fmtSection("Path (hint)", pathHint));
  if (primaryBlobName) parts.push(fmtSection("Primary Blob", primaryBlobName));
  if (numResults != null) parts.push(fmtSection("Num Results", String(numResults)));
  if (isSingleFile != null) parts.push(fmtSection("Is Single File", String(isSingleFile)));
  if (diagnostics != null) parts.push(fmtJsonSection("Diagnostics", diagnostics, { maxChars: 16000 }));
  if (recentChanges != null) parts.push(fmtJsonSection("Recent Changes", recentChanges, { maxChars: 16000 }));
  if (vcsChange != null) parts.push(fmtJsonSection("VCS Change", vcsChange, { maxChars: 16000 }));
  if (editEvents != null) parts.push(fmtJsonSection("Edit Events", editEvents, { maxChars: 16000 }));
  if (blobKeys.length) parts.push(fmtJsonSection("Blobs (keys)", blobKeys.slice(0, 200), { maxChars: 4000 }));
  if (primaryBlobText) {
    const focusLine = extractFirstDiagnosticLine(diagnostics, primaryBlobName || path);
    const snippet = formatLineWindow(primaryBlobText, { focusLine, radius: 40, maxChars: 12000 });
    if (snippet) parts.push(fmtCodeSection(`File Snippet (line-numbered): ${primaryBlobName || path || "unknown"}`, snippet));
  }

  const user = parts.filter(Boolean).join("\n\n").trim();
  if (!user) return null;
  return { ok: true, system, messages: [{ role: "user", content: user }], source: "byok.endpointFields.next_edit_loc" };
}

module.exports = {
  tryFromEndpointFieldsNextEditLoc
};

