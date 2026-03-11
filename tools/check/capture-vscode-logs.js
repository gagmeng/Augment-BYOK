#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const BYOK_LOG_PREFIX = "[Augment-BYOK]";

function die(msg) {
  console.error(`[capture-vscode-logs] ERROR: ${String(msg || "unknown error")}`);
  process.exit(2);
}

function ok(msg) {
  console.log(`[capture-vscode-logs] ${String(msg || "")}`);
}

function warn(msg) {
  console.warn(`[capture-vscode-logs] WARN: ${String(msg || "")}`);
}

function parseArgs(argv) {
  const out = {
    logsRoot: "",
    runDir: "",
    outDir: process.cwd(),
    vscodeOut: "vscode.log",
    webviewOut: "webview.log"
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--logs-root") out.logsRoot = String(argv[++i] || "");
    else if (a === "--run-dir") out.runDir = String(argv[++i] || "");
    else if (a === "--out-dir") out.outDir = String(argv[++i] || "");
    else if (a === "--vscode-out") out.vscodeOut = String(argv[++i] || "");
    else if (a === "--webview-out") out.webviewOut = String(argv[++i] || "");
  }
  return out;
}

function existsDir(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function pickLatestSubdir(dir) {
  const entries = safeReaddir(dir).filter((e) => e.isDirectory());
  let best = null;
  let bestMtime = 0;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      const st = fs.statSync(full);
      const m = Number(st.mtimeMs) || 0;
      if (!best || m > bestMtime) {
        best = full;
        bestMtime = m;
      }
    } catch {}
  }
  return best;
}

function detectVsCodeLogsRoots() {
  const home = os.homedir();
  const roots = [];

  // Linux desktop
  roots.push(path.join(home, ".config", "Code", "logs"));
  roots.push(path.join(home, ".config", "Code - Insiders", "logs"));
  roots.push(path.join(home, ".config", "VSCodium", "logs"));

  // VS Code Remote (server)
  roots.push(path.join(home, ".vscode-server", "data", "logs"));
  roots.push(path.join(home, ".vscode-server-insiders", "data", "logs"));

  // macOS
  roots.push(path.join(home, "Library", "Application Support", "Code", "logs"));
  roots.push(path.join(home, "Library", "Application Support", "Code - Insiders", "logs"));

  // Windows
  if (process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, "Code", "logs"));
    roots.push(path.join(process.env.APPDATA, "Code - Insiders", "logs"));
  }

  return roots;
}

function resolveRunDir({ logsRoot, runDir, detectLogsRoots = detectVsCodeLogsRoots } = {}) {
  const explicitRunDirRaw = String(runDir || "").trim();
  if (explicitRunDirRaw) {
    const explicitRunDir = path.resolve(explicitRunDirRaw);
    if (!existsDir(explicitRunDir)) die(`run dir not found: ${explicitRunDir}`);
    return explicitRunDir;
  }

  const explicitRootRaw = String(logsRoot || "").trim();
  if (explicitRootRaw) {
    const explicitRoot = path.resolve(explicitRootRaw);
    if (!existsDir(explicitRoot)) die(`logs root not found: ${explicitRoot}`);
    const latest = pickLatestSubdir(explicitRoot);
    if (!latest) die(`no runs under logs root: ${explicitRoot}`);
    return latest;
  }

  const detectedRoots = typeof detectLogsRoots === "function" ? detectLogsRoots() : detectVsCodeLogsRoots();
  const candidates = detectedRoots.filter(existsDir);
  if (!candidates.length) {
    die(`could not find VS Code logs root (tried: ${detectedRoots.join(", ")})`);
  }

  // Pick the newest run dir across all roots.
  let best = null;
  let bestMtime = 0;
  for (const root of candidates) {
    const latest = pickLatestSubdir(root);
    if (!latest) continue;
    try {
      const st = fs.statSync(latest);
      const m = Number(st.mtimeMs) || 0;
      if (!best || m > bestMtime) {
        best = latest;
        bestMtime = m;
      }
    } catch {}
  }

  if (!best) die(`no runs found under logs roots: ${candidates.join(", ")}`);
  return best;
}

function listLogFilesByPrefix(runDir, dirPrefixRe) {
  const out = [];
  for (const e of safeReaddir(runDir)) {
    if (!e.isDirectory()) continue;
    if (!dirPrefixRe.test(e.name)) continue;
    const sub = path.join(runDir, e.name);
    for (const f of safeReaddir(sub)) {
      if (!f.isFile()) continue;
      if (!String(f.name).endsWith(".log")) continue;
      out.push(path.join(sub, f.name));
    }
  }
  return out;
}

function readByokLinesFromFiles(filePaths) {
  const out = [];
  for (const p of filePaths) {
    let txt = "";
    try {
      txt = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    if (!txt) continue;
    for (const line of String(txt).split(/\r?\n/)) {
      if (line.includes(BYOK_LOG_PREFIX)) out.push(line);
    }
  }
  return out;
}

function ensureDir(dir) {
  const d = path.resolve(String(dir || ""));
  if (!d || d === path.parse(d).root) die("invalid --out-dir");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function main() {
  const args = parseArgs(process.argv);

  const runDir = resolveRunDir({ logsRoot: args.logsRoot, runDir: args.runDir });
  ok(`using VS Code run dir: ${runDir}`);

  const outDir = ensureDir(args.outDir);
  const vscodeOutPath = path.resolve(outDir, args.vscodeOut);
  const webviewOutPath = path.resolve(outDir, args.webviewOut);

  const exthostLogs = listLogFilesByPrefix(runDir, /^exthost\d+$/i);
  const windowLogs = listLogFilesByPrefix(runDir, /^window\d+$/i);

  const vscodeLines = readByokLinesFromFiles(exthostLogs);
  const webviewLines = readByokLinesFromFiles(windowLogs);

  fs.writeFileSync(vscodeOutPath, vscodeLines.join("\n") + (vscodeLines.length ? "\n" : ""), "utf8");
  fs.writeFileSync(webviewOutPath, webviewLines.join("\n") + (webviewLines.length ? "\n" : ""), "utf8");

  ok(`wrote: ${vscodeOutPath} (lines=${vscodeLines.length}, files=${exthostLogs.length})`);
  ok(`wrote: ${webviewOutPath} (lines=${webviewLines.length}, files=${windowLogs.length})`);

  if (!vscodeLines.length && !webviewLines.length) {
    warn(`no ${BYOK_LOG_PREFIX} lines found (did you reproduce requests after enabling BYOK?)`);
  }
}

module.exports = {
  parseArgs,
  detectVsCodeLogsRoots,
  resolveRunDir,
  listLogFilesByPrefix,
  readByokLinesFromFiles,
  ensureDir,
  main
};

if (require.main === module) main();
