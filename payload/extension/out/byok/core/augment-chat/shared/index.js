"use strict";
const { asRecord, asArray, asString, pick, normalizeNodeType } = require("../../augment-struct");
const {
  formatIdeStateForPrompt,
  formatEditEventsForPrompt,
  formatCheckpointRefForPrompt,
  formatChangePersonalityForPrompt,
  formatImageIdForPrompt,
  formatFileIdForPrompt,
  formatFileNodeForPrompt,
  formatHistorySummaryForPrompt
} = require("../../augment-node-format");

const nodes = require("./nodes");
const tools = require("./tools");
const req = require("./request");

module.exports = {
  asRecord,
  asArray,
  asString,
  pick,
  normalizeNodeType,
  isPlaceholderMessage: nodes.isPlaceholderMessage,
  mapImageFormatToMimeType: nodes.mapImageFormatToMimeType,
  buildUserSegmentsFromRequest: nodes.buildUserSegmentsFromRequest,
  collectExchangeRequestNodes: nodes.collectExchangeRequestNodes,
  collectExchangeOutputNodes: nodes.collectExchangeOutputNodes,
  buildTextOrPartsFromSegments: nodes.buildTextOrPartsFromSegments,
  extractToolResultTextsFromRequestNodes: nodes.extractToolResultTextsFromRequestNodes,
  buildUserSegmentsWithExtraText: req.buildUserSegmentsWithExtraText,
  summarizeToolResultText: nodes.summarizeToolResultText,
  normalizeToolDefinitions: tools.normalizeToolDefinitions,
  resolveToolSchema: tools.resolveToolSchema,
  sanitizeJsonSchemaForTransport: tools.sanitizeJsonSchemaForTransport,
  resolveToolSchemaForTransport: tools.resolveToolSchemaForTransport,
  convertOpenAiTools: tools.convertOpenAiTools,
  convertAnthropicTools: tools.convertAnthropicTools,
  convertGeminiTools: tools.convertGeminiTools,
  convertOpenAiResponsesTools: tools.convertOpenAiResponsesTools,
  buildToolMetaByName: tools.buildToolMetaByName,
  normalizeAugmentChatRequest: req.normalizeAugmentChatRequest,
  coerceRulesText: req.coerceRulesText,
  buildInlineCodeContextText: req.buildInlineCodeContextText,
  buildUserExtraTextParts: req.buildUserExtraTextParts,
  formatIdeStateForPrompt,
  formatEditEventsForPrompt,
  formatCheckpointRefForPrompt,
  formatChangePersonalityForPrompt,
  formatImageIdForPrompt,
  formatFileIdForPrompt,
  formatFileNodeForPrompt,
  formatHistorySummaryForPrompt,
  buildSystemPrompt: req.buildSystemPrompt,
  extractAssistantTextFromOutputNodes: nodes.extractAssistantTextFromOutputNodes,
  extractToolCallsFromOutputNodes: nodes.extractToolCallsFromOutputNodes,
  parseJsonObjectOrEmpty: req.parseJsonObjectOrEmpty
};
