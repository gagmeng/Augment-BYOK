const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveRunDir } = require("../tools/check/capture-vscode-logs");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("resolveRunDir: empty runDir/logsRoot falls back to detected VS Code logs roots", () => {
  withTempDir("augment-byok-capture-logs-", (dir) => {
    const logsRoot = path.join(dir, "logs");
    const olderRun = path.join(logsRoot, "20260306T100000");
    const newerRun = path.join(logsRoot, "20260306T110000");
    fs.mkdirSync(olderRun, { recursive: true });
    fs.mkdirSync(newerRun, { recursive: true });
    fs.utimesSync(olderRun, new Date("2026-03-06T10:00:00Z"), new Date("2026-03-06T10:00:00Z"));
    fs.utimesSync(newerRun, new Date("2026-03-06T11:00:00Z"), new Date("2026-03-06T11:00:00Z"));

    const out = resolveRunDir({
      logsRoot: "",
      runDir: "",
      detectLogsRoots: () => [logsRoot]
    });

    assert.equal(out, newerRun);
  });
});
