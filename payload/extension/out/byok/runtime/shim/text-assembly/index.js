"use strict";

const { normalizeEndpoint } = require("../../../infra/util");
const { maybeBuildDelegatedTextPrompt } = require("../../upstream/official-text-delegation");
const { auditDelegationHit, auditDelegationFailure, normalizeDelegationSource } = require("../../upstream/official-delegation-shared");

async function resolveByokTextPromptContext({
  endpoint,
  body
} = {}) {
  const ep = normalizeEndpoint(endpoint);
  const delegated = await maybeBuildDelegatedTextPrompt({ endpoint: ep, body });
  if (delegated && delegated.ok && Array.isArray(delegated.messages) && delegated.messages.length > 0) {
    const delegatedSource = normalizeDelegationSource(delegated.source);
    auditDelegationHit(`[${ep}] delegated official text assembler hit:`, delegatedSource, { fallbackSource: "unknown" });
    return {
      system: typeof delegated.system === "string" ? delegated.system : "",
      messages: delegated.messages,
      delegatedSource
    };
  }

  const message = auditDelegationFailure("official text assembler delegation failed", delegated?.reason);
  throw new Error(message);
}

module.exports = {
  resolveByokTextPromptContext
};
