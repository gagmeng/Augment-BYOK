"use strict";

const { normalizeEndpoint, normalizeString } = require("../../../infra/util");
const {
  fmtSection,
  fmtCodeSection,
  fmtJsonSection,
  extractDirectives,
  buildSystem,
  historyToMessages,
  extractCodeContext,
  pickMessageText
} = require("./prompt-utils");

function tryFromEndpointFieldsBasic(endpoint, rawBody) {
  const ep = normalizeEndpoint(endpoint);
  const b = rawBody && typeof rawBody === "object" ? rawBody : {};
  const directives = extractDirectives(b);

  if (ep === "/completion") {
    const lang = normalizeString(b.lang);
    const path = normalizeString(b.path);
    const prompt = typeof b.prompt === "string" ? b.prompt : "";
    const suffix = typeof b.suffix === "string" ? b.suffix : "";
    if (!normalizeString(prompt)) return null;

    const system = buildSystem({
      purpose: "completion",
      directives,
      outputConstraints:
        "You are a code completion engine. Output ONLY the completion text.\n- No markdown, no explanations\n- Do NOT wrap in ``` code fences"
    });

    const parts = [];
    if (lang) parts.push(fmtSection("Language", lang));
    if (path) parts.push(fmtSection("Path", path));
    if (prompt) parts.push(fmtCodeSection("Prefix (prompt)", prompt, { lang }));
    if (suffix) parts.push(fmtCodeSection("Suffix", suffix, { lang }));
    const user = parts.filter(Boolean).join("\n\n").trim();
    if (!user) return null;
    return { ok: true, system, messages: [{ role: "user", content: user }], source: "byok.endpointFields.completion" };
  }

  if (ep === "/chat-input-completion") {
    const prompt = typeof b.prompt === "string" ? b.prompt : "";
    const suffix = typeof b.suffix === "string" ? b.suffix : "";
    const path = normalizeString(b.path);
    if (!normalizeString(prompt)) return null;

    const system = buildSystem({
      purpose: "chat-input-completion",
      directives,
      outputConstraints:
        "Continue the user's partial chat input.\n- Output ONLY the completion text (do not repeat the given prompt)\n- No quotes, no markdown\n- Do NOT wrap in ``` code fences"
    });

    const parts = [];
    if (path) parts.push(fmtSection("Path", path));
    if (prompt) parts.push(fmtCodeSection("Prompt", prompt));
    if (suffix) parts.push(fmtCodeSection("Suffix", suffix));
    const user = parts.filter(Boolean).join("\n\n").trim();
    if (!user) return null;
    return { ok: true, system, messages: [{ role: "user", content: user }], source: "byok.endpointFields.chat-input-completion" };
  }

  if (ep === "/prompt-enhancer") {
    const system = buildSystem({
      purpose: "prompt-enhancer",
      directives,
      outputConstraints:
        "Rewrite the prompt to be clearer and more specific.\n- Output ONLY the improved prompt text\n- No preface, no analysis\n- Do NOT wrap in ``` code fences"
    });
    const history = historyToMessages(b.chat_history ?? b.chatHistory, { maxItems: 12 });
    const msg = pickMessageText(b);
    const { combined } = extractCodeContext(b);

    const parts = [];
    if (msg) parts.push(fmtSection("Original Prompt", msg));
    if (combined.trim()) parts.push(fmtCodeSection("Code Context", combined));
    const nodes = b.nodes;
    if (Array.isArray(nodes) && nodes.length) parts.push(fmtJsonSection("Nodes", nodes, { maxChars: 8000 }));

    const user = parts.filter(Boolean).join("\n\n").trim();
    if (!user) return null;
    return { ok: true, system, messages: [...history, { role: "user", content: user }], source: "byok.endpointFields.prompt-enhancer" };
  }

  if (ep === "/generate-commit-message-stream") {
    const diff = typeof b.diff === "string" ? b.diff : "";
    const stats = b.changed_file_stats ?? b.changedFileStats;
    const relevant = b.relevant_commit_messages ?? b.relevantCommitMessages;
    const examples = b.example_commit_messages ?? b.exampleCommitMessages;
    if (!normalizeString(diff) && stats == null && relevant == null && examples == null) return null;

    const system = buildSystem({
      purpose: "generate-commit-message-stream",
      directives,
      outputConstraints:
        "Generate ONE concise git commit message subject line.\n- Output ONLY the subject line\n- No quotes, no trailing period\n- Do NOT wrap in ``` code fences"
    });

    const parts = [];
    if (diff) parts.push(fmtCodeSection("Diff", diff, { lang: "diff" }));
    if (stats && typeof stats === "object") parts.push(fmtJsonSection("Changed File Stats", stats, { maxChars: 6000 }));
    if (relevant != null) parts.push(fmtJsonSection("Relevant Commit Messages", relevant, { maxChars: 6000 }));
    if (examples != null) parts.push(fmtJsonSection("Example Commit Messages", examples, { maxChars: 6000 }));

    const user = parts.filter(Boolean).join("\n\n").trim();
    if (!user) return null;
    return { ok: true, system, messages: [{ role: "user", content: user }], source: "byok.endpointFields.generate-commit-message-stream" };
  }

  return null;
}

module.exports = {
  tryFromEndpointFieldsBasic
};
