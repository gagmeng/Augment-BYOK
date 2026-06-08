"use strict";

const crypto = require("crypto");
const fs = require("fs");

const CHUNK_BYTES = 1 << 20; // 1 MiB

function sha256FileHex(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(CHUNK_BYTES);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, CHUNK_BYTES, null)) > 0) {
      hash.update(bytesRead === CHUNK_BYTES ? buf : buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

module.exports = { sha256FileHex };

