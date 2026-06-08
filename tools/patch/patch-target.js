"use strict";

const fs = require("fs");
const path = require("path");

const { readJson, readText, writeJson, writeText } = require("../lib/fs");
const { ensureMarker } = require("../lib/patch");

const textTxns = new Map();

function normalizeKey(filePath) {
  return path.resolve(String(filePath || ""));
}

function assertFileExists(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  return filePath;
}

function beginPatchTextTxn(filePath) {
  const key = normalizeKey(filePath);
  if (textTxns.has(key)) throw new Error(`patch text txn already open: ${key}`);
  const target = assertFileExists(key);
  const original = readText(target);
  textTxns.set(key, { current: original, dirty: false });
  return { key, original };
}

function commitPatchTextTxn(filePath) {
  const key = normalizeKey(filePath);
  const txn = textTxns.get(key);
  if (!txn) throw new Error(`no patch text txn to commit: ${key}`);
  textTxns.delete(key);
  if (txn.dirty) writeText(key, txn.current);
  return { wrote: txn.dirty };
}

function rollbackPatchTextTxn(filePath) {
  const key = normalizeKey(filePath);
  textTxns.delete(key);
}

function loadPatchText(filePath, { marker } = {}) {
  const key = normalizeKey(filePath);
  const txn = textTxns.get(key);
  if (txn) {
    return { original: txn.current, alreadyPatched: !!(marker && txn.current.includes(marker)) };
  }
  const target = assertFileExists(key);
  const original = readText(target);
  return { original, alreadyPatched: !!(marker && original.includes(marker)) };
}

function savePatchText(filePath, text, { marker } = {}) {
  const next = marker ? ensureMarker(String(text ?? ""), marker) : String(text ?? "");
  const key = normalizeKey(filePath);
  const txn = textTxns.get(key);
  if (txn) {
    if (txn.current !== next) {
      txn.current = next;
      txn.dirty = true;
    }
    return next;
  }
  writeText(key, next);
  return next;
}

function loadPatchJson(filePath) {
  return readJson(assertFileExists(filePath));
}

function savePatchJson(filePath, value) {
  writeJson(filePath, value);
  return value;
}

module.exports = {
  assertFileExists,
  loadPatchJson,
  loadPatchText,
  savePatchJson,
  savePatchText,
  beginPatchTextTxn,
  commitPatchTextTxn,
  rollbackPatchTextTxn
};
