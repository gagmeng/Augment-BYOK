"use strict";

const { normalizeString } = require("../../../infra/util");
const { isObject } = require("../official-delegation-shared");

function normalizeRole(value) {
  const role = normalizeString(value).toLowerCase();
  if (role === "system" || role === "user" || role === "assistant") return role;
  if (role === "developer") return "system";
  if (role === "human") return "user";
  if (role === "ai" || role === "model") return "assistant";
  return "";
}

function toText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const type = normalizeString(item.type ?? item.kind).toLowerCase();
      const text =
        (typeof item.text === "string" && item.text) ||
        (typeof item.input_text === "string" && item.input_text) ||
        (typeof item.value === "string" && item.value) ||
        (typeof item.content === "string" && item.content) ||
        "";
      if (!text) continue;
      if (!type || type.includes("text")) parts.push(text);
    }
    return parts.join("\n").trim();
  }

  if (typeof value.text === "string") return value.text;
  if (typeof value.value === "string") return value.value;
  if (typeof value.content === "string") return value.content;
  return "";
}

function truncate(text, maxChars) {
  const s = String(text ?? "");
  if (!Number.isFinite(Number(maxChars)) || Number(maxChars) <= 0) return s;
  const n = Number(maxChars);
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 12)) + "\n…(truncated)";
}

function fmtSection(title, content) {
  const t = normalizeString(title);
  const c = normalizeString(content);
  if (!t || !c) return "";
  return `${t}:\n${c}`;
}

function fmtCodeSection(title, code, { lang = "" } = {}) {
  const t = normalizeString(title);
  const c = typeof code === "string" ? code : "";
  if (!t || !c) return "";
  const l = normalizeString(lang);
  return `${t}:\n\`\`\`${l}\n${c}\n\`\`\``.trim();
}

function jsonText(value, { maxChars = 8000 } = {}) {
  if (value == null) return "";
  try {
    const s = JSON.stringify(value, null, 2);
    return truncate(s, maxChars);
  } catch {
    return "";
  }
}

function fmtJsonSection(title, value, { maxChars = 8000 } = {}) {
  const t = normalizeString(title);
  const j = jsonText(value, { maxChars });
  if (!t || !j) return "";
  return `${t} (json):\n\`\`\`json\n${j}\n\`\`\``.trim();
}

function coerceRulesText(rules) {
  if (Array.isArray(rules)) return rules.map((x) => normalizeString(String(x))).filter(Boolean).join("\n");
  return normalizeString(rules);
}

function extractDirectives(body) {
  const b = body && typeof body === "object" ? body : {};
  const userGuidelines = normalizeString(b.user_guidelines ?? b.userGuidelines);
  const workspaceGuidelines = normalizeString(b.workspace_guidelines ?? b.workspaceGuidelines);
  const rulesText = coerceRulesText(b.rules);
  return { userGuidelines, workspaceGuidelines, rulesText };
}

function buildSystem({ purpose, directives, outputConstraints }) {
  const p = normalizeString(purpose) || "assistant";
  const { userGuidelines, workspaceGuidelines, rulesText } = directives || {};

  const parts = [`You are Augment-BYOK (${p}).`, "Follow all provided guidelines and rules.", "Prefer correctness and minimal changes."];

  const g = [fmtSection("User Guidelines", userGuidelines), fmtSection("Workspace Guidelines", workspaceGuidelines), fmtSection("Rules", rulesText)]
    .filter(Boolean)
    .join("\n\n");
  if (g) parts.push("", g);

  const oc = normalizeString(outputConstraints);
  if (oc) parts.push("", oc);

  return parts.join("\n").trim();
}

function historyToMessages(history, { maxItems = 12 } = {}) {
  const items = Array.isArray(history) ? history.slice(-maxItems) : [];
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const role = normalizeRole(it.role ?? it.sender ?? it.type);
    const content = normalizeString(it.text ?? it.content ?? it.message);
    if (!role || !content) continue;
    out.push({ role, content });
  }
  return out;
}

function extractCodeContext(body) {
  const b = body && typeof body === "object" ? body : {};
  const prefix = typeof b.prefix === "string" ? b.prefix : "";
  const selectedText =
    typeof b.selected_text === "string"
      ? b.selected_text
      : typeof b.selectedText === "string"
        ? b.selectedText
        : typeof b.selected_code === "string"
          ? b.selected_code
          : typeof b.selectedCode === "string"
            ? b.selectedCode
            : "";
  const suffix = typeof b.suffix === "string" ? b.suffix : "";
  return { prefix, selectedText, suffix, combined: `${prefix}${selectedText}${suffix}` };
}

function pickMessageText(body) {
  const b = body && typeof body === "object" ? body : {};
  return (
    normalizeString(b.message) ||
    normalizeString(b.prompt) ||
    normalizeString(b.instruction) ||
    normalizeString(b.user_prompt) ||
    normalizeString(b.userPrompt) ||
    normalizeString(b.query)
  );
}

module.exports = {
  isObject,
  normalizeRole,
  toText,
  truncate,
  fmtSection,
  fmtCodeSection,
  fmtJsonSection,
  extractDirectives,
  buildSystem,
  historyToMessages,
  extractCodeContext,
  pickMessageText
};
