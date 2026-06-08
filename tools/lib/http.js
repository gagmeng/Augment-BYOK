"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");

const { ensureDir } = require("./fs");

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRYABLE_NET_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"]);

function backoffDelayMs(attempt) {
  // attempt: 1..N, exponential with light jitter, capped at 8s
  const base = Math.min(8000, 500 * Math.pow(2, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function decompressedStream(res) {
  const encoding = String(res.headers["content-encoding"] || "").toLowerCase().trim();
  if (!encoding) return res;
  if (encoding === "gzip" || encoding === "x-gzip") return res.pipe(zlib.createGunzip());
  if (encoding === "br") return res.pipe(zlib.createBrotliDecompress());
  if (encoding === "deflate") return res.pipe(zlib.createInflate());
  if (encoding === "identity") return res;
  // Unknown encoding: pass-through; let pipeline fail clearly if data is malformed.
  return res;
}

function fetchOnce(url, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "user-agent": "augment-byok-build", "accept-encoding": "gzip, br, deflate" } }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && typeof res.headers.location === "string" && res.headers.location) {
        res.resume();
        resolve({ kind: "redirect", location: res.headers.location });
        return;
      }
      if (code !== 200) {
        const msg = `HTTP ${code} ${res.statusMessage || ""}`.trim();
        res.resume();
        const err = new Error(msg);
        err.status = code;
        err.retryable = code >= 500 && code <= 599;
        resolve({ kind: "error", error: err });
        return;
      }
      resolve({ kind: "ok", stream: decompressedStream(res), response: res });
    });
    req.setTimeout(Math.max(1000, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS), () => {
      req.destroy(Object.assign(new Error(`request timeout after ${timeoutMs}ms`), { code: "ETIMEDOUT", retryable: true }));
    });
    req.on("error", reject);
  });
}

async function downloadFile(url, outPath, { timeoutMs, maxAttempts, onAttempt } = {}) {
  const totalTimeout = Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
  const attempts = Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS);

  ensureDir(path.dirname(outPath));
  const tmp = outPath + ".tmp";

  let currentUrl = String(url || "");
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let result;
    try {
      result = await fetchOnce(currentUrl, { timeoutMs: totalTimeout });
    } catch (err) {
      lastError = err;
      const retryable = err && (RETRYABLE_NET_CODES.has(err.code) || err.retryable === true);
      if (typeof onAttempt === "function") onAttempt({ attempt, url: currentUrl, error: err, retryable });
      if (!retryable || attempt === attempts) throw new Error(`download failed: ${err && err.message ? err.message : String(err)} (url=${currentUrl})`);
      await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
      continue;
    }

    if (result.kind === "redirect") {
      currentUrl = result.location;
      attempt -= 1; // redirect does not consume a retry attempt
      if (attempt < 0) attempt = 0;
      continue;
    }

    if (result.kind === "error") {
      const err = result.error;
      lastError = err;
      const retryable = err.retryable === true;
      if (typeof onAttempt === "function") onAttempt({ attempt, url: currentUrl, error: err, retryable });
      if (!retryable || attempt === attempts) throw new Error(`download failed: ${err.message} (url=${currentUrl})`);
      await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
      continue;
    }

    // result.kind === "ok"
    const file = fs.createWriteStream(tmp);
    try {
      await pipeline(result.stream, file);
      fs.renameSync(tmp, outPath);
      return;
    } catch (err) {
      lastError = err;
      try { fs.rmSync(tmp, { force: true }); } catch {}
      const retryable = err && (RETRYABLE_NET_CODES.has(err.code) || err.code === "ETIMEDOUT");
      if (typeof onAttempt === "function") onAttempt({ attempt, url: currentUrl, error: err, retryable });
      if (!retryable || attempt === attempts) throw new Error(`download failed: ${err.message} (url=${currentUrl})`);
      await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
    }
  }

  throw lastError || new Error(`download failed after ${attempts} attempts`);
}

module.exports = { downloadFile, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_MAX_ATTEMPTS };
