"use strict";

const fs = require("fs");

const { readJson, readText, writeJson, writeText } = require("../lib/fs");
const { ensureMarker } = require("../lib/patch");

function assertFileExists(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  return filePath;
}

function loadPatchText(filePath, { marker } = {}) {
  const target = assertFileExists(filePath);
  const original = readText(target);
  return { original, alreadyPatched: !!(marker && original.includes(marker)) };
}

function savePatchText(filePath, text, { marker } = {}) {
  const next = marker ? ensureMarker(String(text ?? ""), marker) : String(text ?? "");
  writeText(filePath, next);
  return next;
}

function loadPatchJson(filePath) {
  return readJson(assertFileExists(filePath));
}

function savePatchJson(filePath, value) {
  writeJson(filePath, value);
  return value;
}

module.exports = { assertFileExists, loadPatchJson, loadPatchText, savePatchJson, savePatchText };
