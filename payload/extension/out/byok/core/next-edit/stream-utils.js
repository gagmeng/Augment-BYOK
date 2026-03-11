"use strict";

const { normalizeString } = require("../../infra/util");
const { normalizeBlobsMap, coerceBlobText, pickBestBlobName, getBlobValue } = require("../blob-utils");
const { pickPath, pickBlobNameHint } = require("./fields");
const { clampInt } = require("../number-utils");
const { bestMatchIndex, bestInsertionIndex } = require("../text-match");
const { utf32Length, utf16ToUtf32Offset, sliceUtf32 } = require("../unicode-utils");

function tailWithMarker(s, maxChars) {
  const text = typeof s === "string" ? s : "";
  const n = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Math.floor(Number(maxChars)) : 0;
  if (!n || text.length <= n) return text;
  return `…(truncated)\n${text.slice(text.length - n)}`;
}

function headWithMarker(s, maxChars) {
  const text = typeof s === "string" ? s : "";
  const n = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Math.floor(Number(maxChars)) : 0;
  if (!n || text.length <= n) return text;
  return `${text.slice(0, n)}\n…(truncated)`;
}

function pickSelectedText(body) {
  const b = body && typeof body === "object" ? body : {};
  const v = b.selected_text ?? b.selectedText ?? b.selected_code ?? b.selectedCode;
  return typeof v === "string" ? v : "";
}

function inferSelectionRange({ body, prefix, suffix, selectedText, blobText } = {}) {
  const b = body && typeof body === "object" ? body : {};

  const beginRaw = b.selection_begin_char ?? b.selectionBeginChar;
  const endRaw = b.selection_end_char ?? b.selectionEndChar;
  let selectionBegin = Number.isFinite(Number(beginRaw)) ? clampInt(beginRaw, { min: 0 }) : null;
  let selectionEnd = Number.isFinite(Number(endRaw)) ? clampInt(endRaw, { min: 0 }) : null;

  // 优先：从 blob 文本中推断 char range（prefix/suffix 作为 hint）
  if ((selectionBegin == null || selectionEnd == null) && typeof blobText === "string" && blobText) {
    const pre = typeof prefix === "string" ? prefix : "";
    const suf = typeof suffix === "string" ? suffix : "";
    const sel = typeof selectedText === "string" ? selectedText : "";
    const prefixHint = pre ? pre.slice(Math.max(0, pre.length - 400)) : "";
    const suffixHint = suf ? suf.slice(0, 400) : "";

    if (sel) {
      const idx16 = bestMatchIndex(blobText, sel, { prefixHint, suffixHint });
      if (idx16 >= 0) {
        const begin32 = utf16ToUtf32Offset(blobText, idx16);
        selectionBegin = begin32;
        selectionEnd = begin32 + utf32Length(sel);
      }
    }
    if (selectionBegin == null || selectionEnd == null) {
      const ins16 = bestInsertionIndex(blobText, { prefixHint, suffixHint });
      const ins32 = utf16ToUtf32Offset(blobText, ins16);
      selectionBegin = ins32;
      selectionEnd = ins32;
    }
  }

  // 兜底：selection_* 缺失时，用 prefix/selected_text 推断（避免 UI 收到 0..0 导致定位错乱）
  if (selectionBegin == null) selectionBegin = typeof prefix === "string" && prefix ? utf32Length(prefix) : 0;
  if (selectionEnd == null) selectionEnd = selectionBegin + (typeof selectedText === "string" ? utf32Length(selectedText) : 0);
  if (selectionEnd < selectionBegin) selectionEnd = selectionBegin;

  return { selectionBegin, selectionEnd };
}

function buildNextEditStreamRuntimeContext(body) {
  const b = body && typeof body === "object" ? body : {};
  const path = pickPath(b);
  const prefix = typeof b.prefix === "string" ? b.prefix : "";
  const suffix = typeof b.suffix === "string" ? b.suffix : "";
  const selectedText = pickSelectedText(b);

  const blobNameHint = pickBlobNameHint(b);
  let blobs = normalizeBlobsMap(b.blobs);

  // 优先用 request 自带 prefix/selected/suffix 还原全量 blob 文本（避免读盘、且更贴近 request 时刻的缓冲区状态）。
  const combined = `${prefix}${selectedText}${suffix}`;
  const combinedKey = normalizeString(blobNameHint) || normalizeString(path);
  if (combinedKey && combined && combined.length <= 2_000_000) {
    const existing = blobs ? coerceBlobText(getBlobValue(blobs, combinedKey)) : "";
    if (!existing) blobs = { ...(blobs || {}), [combinedKey]: combined };
  }

  const blobKeyForText = pickBestBlobName({ blobs, blobNameHint, pathHint: path });
  const blobText = coerceBlobText(getBlobValue(blobs, blobKeyForText));

  const { selectionBegin, selectionEnd } = inferSelectionRange({ body: b, prefix, suffix, selectedText, blobText });

  // 兼容：selected_text 缺失但 blobs+selection 存在时，从 blob 文本切片恢复 existing_code
  let existingCode = selectedText;
  if (!existingCode && blobText) existingCode = sliceUtf32(blobText, selectionBegin, selectionEnd);

  const PROMPT_WINDOW_CHARS = 12000;
  const promptPrefix = prefix || (blobText ? tailWithMarker(sliceUtf32(blobText, 0, selectionBegin), PROMPT_WINDOW_CHARS) : "");
  const promptSelectedText =
    typeof selectedText === "string" && selectedText
      ? headWithMarker(selectedText, PROMPT_WINDOW_CHARS)
      : blobText
        ? headWithMarker(sliceUtf32(blobText, selectionBegin, selectionEnd), PROMPT_WINDOW_CHARS)
        : "";
  const promptSuffix = suffix || (blobText ? headWithMarker(sliceUtf32(blobText, selectionEnd), PROMPT_WINDOW_CHARS) : "");

  const promptBody = {
    ...(b && typeof b === "object" ? b : {}),
    ...(blobs ? { blobs } : null),
    ...(typeof promptPrefix === "string" ? { prefix: promptPrefix } : null),
    ...(typeof promptSelectedText === "string" ? { selected_text: promptSelectedText } : null),
    ...(typeof promptSuffix === "string" ? { suffix: promptSuffix } : null),
    selection_begin_char: selectionBegin,
    selection_end_char: selectionEnd
  };

  const blobName = normalizeString(blobNameHint) || normalizeString(blobKeyForText) || normalizeString(path);
  return { promptBody, path, blobName, selectionBegin, selectionEnd, existingCode };
}

module.exports = { buildNextEditStreamRuntimeContext };
