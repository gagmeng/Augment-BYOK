"use strict";

const { spawnSync } = require("child_process");
let cachedPythonSpec = null;

function run(cmd, args, { cwd } = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.error) throw r.error;
  if (typeof r.status === "number" && r.status !== 0) throw new Error(`command failed: ${cmd} ${args.join(" ")}`);
}

function resolvePythonSpec({ cwd, spawnSyncImpl, useCache } = {}) {
  const runner = typeof spawnSyncImpl === "function" ? spawnSyncImpl : spawnSync;
  const canUseCache = useCache !== false;
  if (canUseCache && cachedPythonSpec && typeof cachedPythonSpec.cmd === "string") {
    return { cmd: cachedPythonSpec.cmd, argsPrefix: [...cachedPythonSpec.argsPrefix] };
  }

  const candidates = [{ cmd: "python3", argsPrefix: [] }, { cmd: "py", argsPrefix: ["-3"] }, { cmd: "python", argsPrefix: [] }];
  for (const spec of candidates) {
    const probe = runner(spec.cmd, [...spec.argsPrefix, "--version"], { cwd, stdio: "ignore" });
    if (probe?.error) {
      if (probe.error.code === "ENOENT") continue;
      continue;
    }
    if (probe?.status === 0) {
      const resolved = { cmd: spec.cmd, argsPrefix: [...spec.argsPrefix] };
      if (canUseCache) cachedPythonSpec = resolved;
      return resolved;
    }
  }

  throw new Error("python runtime not found (tried: python3, py -3, python)");
}

function runPython(args, { cwd } = {}) {
  const spec = resolvePythonSpec({ cwd });
  run(spec.cmd, [...spec.argsPrefix, ...(Array.isArray(args) ? args : [])], { cwd });
}

function resetPythonSpecCacheForTest() {
  cachedPythonSpec = null;
}

module.exports = { run, resolvePythonSpec, runPython, resetPythonSpecCacheForTest };
