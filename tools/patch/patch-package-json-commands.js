#!/usr/bin/env node
"use strict";

const path = require("path");

const { loadPatchJson, savePatchJson } = require("./patch-target");

const COMMANDS = [
  { command: "augment-byok.enable", title: "BYOK: Enable" },
  { command: "augment-byok.disable", title: "BYOK: Disable (Rollback)" },
  { command: "augment-byok.reloadConfig", title: "BYOK: Reload Config" },
  { command: "augment-byok.openConfigPanel", title: "BYOK: Open Config Panel" },
  { command: "augment-byok.clearHistorySummaryCache", title: "BYOK: Clear History Summary Cache" },
  { command: "augment-byok.importConfig", title: "BYOK: Import Config" },
  { command: "augment-byok.exportConfig", title: "BYOK: Export Config" }
];

function stripAdvancedSettings(contributes) {
  const conf = contributes && typeof contributes === "object" ? contributes.configuration : null;
  const blocks = Array.isArray(conf) ? conf : conf && typeof conf === "object" ? [conf] : [];
  const removed = [];
  for (const b of blocks) {
    const props = b && typeof b === "object" ? b.properties : null;
    if (!props || typeof props !== "object") continue;
    for (const k of Object.keys(props)) {
      if (!k || typeof k !== "string") continue;
      if (k.startsWith("augment.advanced.")) {
        removed.push(k);
        delete props[k];
        continue;
      }
      if (k !== "augment.advanced") continue;
      const adv = props[k];
      const advProps = adv && typeof adv === "object" ? adv.properties : null;
      if (!advProps || typeof advProps !== "object") continue;
      for (const sub of ["apiToken", "completionURL", "chat", "codeEdits"]) {
        if (!Object.prototype.hasOwnProperty.call(advProps, sub)) continue;
        removed.push(`augment.advanced.${sub}`);
        delete advProps[sub];
      }
    }
  }
  return removed;
}

function patchPackageJsonCommands(filePath) {
  const pkg = loadPatchJson(filePath);
  if (!pkg || typeof pkg !== "object") throw new Error("package.json not object");

  const contributes = (pkg.contributes && typeof pkg.contributes === "object") ? pkg.contributes : (pkg.contributes = {});
  const commands = Array.isArray(contributes.commands) ? contributes.commands : (contributes.commands = []);

  const existing = new Set(commands.map((c) => (c && typeof c.command === "string" ? c.command : "")).filter(Boolean));
  for (const c of COMMANDS) {
    if (existing.has(c.command)) continue;
    commands.push(c);
  }

  const removedSettings = stripAdvancedSettings(contributes);

  savePatchJson(filePath, pkg);
  return { changed: true, added: COMMANDS.filter((c) => !existing.has(c.command)).map((c) => c.command), removedSettings };
}

module.exports = { patchPackageJsonCommands };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/package.json>`);
    process.exit(2);
  }
  patchPackageJsonCommands(filePath);
}
