#!/usr/bin/env node
"use strict";

const path = require("path");

const { injectIntoArrowPropertyFunctions } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");

const MARKER = "__augment_byok_model_picker_byok_only_v1";

function patchModelPickerByokOnly(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  const injection =
    `try{` +
    `const __byok_state=require("./byok/config/state").state;` +
    `if(__byok_state&&__byok_state.runtimeEnabled){` +
    `return require("./byok/core/model-picker").getMergedAdditionalChatModelsByokOnly({` +
    `modelDisplayNameToId:(this&&this._config&&this._config.config&&this._config.config.chat&&this._config.config.chat.modelDisplayNameToId),` +
    `additionalChatModelsRaw:(this&&this._featureFlagManager&&this._featureFlagManager.currentFlags?this._featureFlagManager.currentFlags.additionalChatModels:""),` +
    `logger:(this&&this._logger)` +
    `});` +
    `}` +
    `}catch{}`;

  const injected = injectIntoArrowPropertyFunctions(original, "getMergedAdditionalChatModels", injection);
  let next = injected.out;

  savePatchText(filePath, next, { marker: MARKER });
  return { changed: true, reason: "patched", patched: injected.count };
}

module.exports = { patchModelPickerByokOnly };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchModelPickerByokOnly(filePath);
}
