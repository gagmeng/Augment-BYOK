"use strict";

function normalizeChatResponseMeta(value) {
  const meta = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    checkpointNotFound: meta.checkpointNotFound === true,
    workspaceFileChunks: Array.isArray(meta.workspaceFileChunks) ? meta.workspaceFileChunks : []
  };
}

function mergeChatResponseMeta(...values) {
  const merged = { checkpointNotFound: false, workspaceFileChunks: [] };
  for (const value of values) {
    const meta = normalizeChatResponseMeta(value);
    if (meta.checkpointNotFound) merged.checkpointNotFound = true;
    if (!merged.workspaceFileChunks.length && meta.workspaceFileChunks.length) merged.workspaceFileChunks = meta.workspaceFileChunks;
  }
  return merged;
}

function applyChatResponseMeta(target, value, { workspaceFileChunksOnce = false, alreadyInjectedWorkspaceFileChunks = false } = {}) {
  const meta = normalizeChatResponseMeta(value);
  const out = target && typeof target === "object" ? { ...target } : {};
  if (meta.checkpointNotFound) out.checkpoint_not_found = true;

  const injectWorkspaceFileChunks = meta.workspaceFileChunks.length > 0 && (!workspaceFileChunksOnce || !alreadyInjectedWorkspaceFileChunks);
  if (injectWorkspaceFileChunks) out.workspace_file_chunks = meta.workspaceFileChunks;

  return { out, injectedWorkspaceFileChunks: injectWorkspaceFileChunks, meta };
}

async function* injectChatResponseMetaStream(src, value) {
  const meta = normalizeChatResponseMeta(value);
  if (!meta.checkpointNotFound && meta.workspaceFileChunks.length === 0) {
    yield* src;
    return;
  }

  let injectedWorkspaceFileChunks = false;
  for await (const chunk of src) {
    if (!chunk || typeof chunk !== "object") {
      yield chunk;
      continue;
    }
    const res = applyChatResponseMeta(chunk, meta, {
      workspaceFileChunksOnce: true,
      alreadyInjectedWorkspaceFileChunks: injectedWorkspaceFileChunks
    });
    injectedWorkspaceFileChunks = injectedWorkspaceFileChunks || res.injectedWorkspaceFileChunks;
    yield res.out;
  }
}

module.exports = {
  normalizeChatResponseMeta,
  mergeChatResponseMeta,
  applyChatResponseMeta,
  injectChatResponseMetaStream
};
