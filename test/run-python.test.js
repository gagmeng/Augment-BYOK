const test = require("node:test");
const assert = require("node:assert/strict");

const { resolvePythonSpec, resetPythonSpecCacheForTest } = require("../tools/lib/run");

function makeNotFoundError() {
  const err = new Error("not found");
  err.code = "ENOENT";
  return err;
}

test("resolvePythonSpec: prefers python3 when available", () => {
  resetPythonSpecCacheForTest();
  const calls = [];
  const spec = resolvePythonSpec({
    useCache: false,
    spawnSyncImpl(cmd, args) {
      calls.push([cmd, args]);
      if (cmd === "python3") return { status: 0 };
      return { error: makeNotFoundError() };
    }
  });

  assert.deepEqual(spec, { cmd: "python3", argsPrefix: [] });
  assert.deepEqual(calls, [["python3", ["--version"]]]);
});

test("resolvePythonSpec: falls back to py -3 on Windows-style environments", () => {
  resetPythonSpecCacheForTest();
  const calls = [];
  const spec = resolvePythonSpec({
    useCache: false,
    spawnSyncImpl(cmd, args) {
      calls.push([cmd, args]);
      if (cmd === "python3") return { error: makeNotFoundError() };
      if (cmd === "py") return { status: 0 };
      return { error: makeNotFoundError() };
    }
  });

  assert.deepEqual(spec, { cmd: "py", argsPrefix: ["-3"] });
  assert.deepEqual(calls, [
    ["python3", ["--version"]],
    ["py", ["-3", "--version"]]
  ]);
});

test("resolvePythonSpec: falls back to plain python when needed", () => {
  resetPythonSpecCacheForTest();
  const calls = [];
  const spec = resolvePythonSpec({
    useCache: false,
    spawnSyncImpl(cmd, args) {
      calls.push([cmd, args]);
      if (cmd === "python") return { status: 0 };
      return { error: makeNotFoundError() };
    }
  });

  assert.deepEqual(spec, { cmd: "python", argsPrefix: [] });
  assert.deepEqual(calls, [
    ["python3", ["--version"]],
    ["py", ["-3", "--version"]],
    ["python", ["--version"]]
  ]);
});
