"use strict";

function ensureMarker(src, marker) {
  if (src.includes(marker)) return src;
  return `${src}\n;/*${marker}*/\n`;
}

function assertContainsAll(src, needles, label) {
  const s = String(src || "");
  const list = Array.isArray(needles) ? needles : [];
  for (const needle of list) {
    const n = String(needle || "");
    if (!n) continue;
    if (!s.includes(n)) throw new Error(`${label}: missing ${JSON.stringify(n)}`);
  }
}

function assertContainsNone(src, needles, label) {
  const s = String(src || "");
  const list = Array.isArray(needles) ? needles : [];
  for (const needle of list) {
    const n = String(needle || "");
    if (!n) continue;
    if (s.includes(n)) throw new Error(`${label}: found ${JSON.stringify(n)}`);
  }
}

function replaceOnce(src, needle, replacement, label) {
  const s = String(src || "");
  const n = String(needle || "");
  const r = String(replacement ?? "");
  const idx = s.indexOf(n);
  if (idx < 0) throw new Error(`${label} needle not found (upstream may have changed)`);
  if (s.indexOf(n, idx + n.length) >= 0) throw new Error(`${label} needle matched multiple times (refuse to patch)`);
  return s.replace(n, r);
}

function replaceOnceRegex(src, re, replacement, label) {
  const s = String(src || "");
  const rx = re instanceof RegExp ? re : null;
  if (!rx) throw new Error(`${label} invalid regex`);
  const matches = Array.from(s.matchAll(rx));
  if (matches.length === 0) throw new Error(`${label} needle not found (upstream may have changed)`);
  if (matches.length > 1) throw new Error(`${label} needle matched multiple times (refuse to patch): matched=${matches.length}`);
  const m = matches[0];
  const idx = typeof m.index === "number" ? m.index : -1;
  if (idx < 0) throw new Error(`${label} needle match missing index`);
  const rep = typeof replacement === "function" ? String(replacement(m) ?? "") : String(replacement ?? "");
  return s.slice(0, idx) + rep + s.slice(idx + m[0].length);
}

function findMatchIndexes(src, re, label) {
  const matches = Array.from(String(src || "").matchAll(re));
  if (matches.length === 0) throw new Error(`${label} needle not found (upstream may have changed): matched=0`);
  const indexes = matches.map((m) => m.index).filter((i) => typeof i === "number" && i >= 0);
  if (indexes.length !== matches.length) throw new Error(`${label} needle match missing index`);
  return indexes.sort((a, b) => a - b);
}

function parseParamNames(paramsRaw) {
  return String(paramsRaw || "")
    .split(",")
    .map((part) => part.split("=")[0].trim())
    .filter(Boolean);
}

function injectIntoAsyncMethods(src, methodName, buildInjection) {
  const s = String(src || "");
  const re = new RegExp(`async\\s+${methodName}\\s*\\(([^)]*)\\)`, "g");
  const matches = Array.from(s.matchAll(re));
  if (matches.length === 0) throw new Error(`${methodName} needle not found (upstream may have changed)`);

  let out = s;
  let patched = 0;
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const idx = typeof match.index === "number" ? match.index : -1;
    if (idx < 0) throw new Error(`${methodName} needle match missing index`);
    const openBrace = out.indexOf("{", idx);
    if (openBrace < 0) throw new Error(`${methodName} patch: failed to locate method body opening brace`);

    const injection =
      typeof buildInjection === "function"
        ? String(buildInjection({ params: parseParamNames(match[1] || ""), match, index: idx }) ?? "")
        : String(buildInjection ?? "");
    if (!injection) continue;

    out = out.slice(0, openBrace + 1) + injection + out.slice(openBrace + 1);
    patched += 1;
  }

  return { out, count: patched };
}

function injectIntoArrowPropertyFunctions(src, propertyName, buildInjection) {
  const s = String(src || "");
  const re = new RegExp(`${propertyName}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*\\{`, "g");
  const matches = Array.from(s.matchAll(re));
  if (matches.length === 0) throw new Error(`${propertyName} needle not found (upstream may have changed)`);

  let out = s;
  let patched = 0;
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const idx = typeof match.index === "number" ? match.index : -1;
    if (idx < 0) throw new Error(`${propertyName} needle match missing index`);
    const openBrace = out.indexOf("{", idx);
    if (openBrace < 0) throw new Error(`${propertyName} patch: failed to locate function body opening brace`);

    const injection =
      typeof buildInjection === "function"
        ? String(buildInjection({ params: parseParamNames(match[1] || ""), match, index: idx }) ?? "")
        : String(buildInjection ?? "");
    if (!injection) continue;

    out = out.slice(0, openBrace + 1) + injection + out.slice(openBrace + 1);
    patched += 1;
  }

  return { out, count: patched };
}

function insertBeforeSourceMappingURL(src, injection) {
  const idx = src.lastIndexOf("\n//# sourceMappingURL=");
  if (idx < 0) return src + injection;
  return src.slice(0, idx) + injection + src.slice(idx);
}

function findExportedFactoryVar(src, exportName) {
  const name = String(exportName || "").trim();
  if (!name) throw new Error("findExportedFactoryVar: exportName missing");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`["']?${escaped}["']?\\s*:\\s*\\(\\)\\s*=>\\s*([A-Za-z0-9_$]+)`);
  const match = String(src || "").match(re);
  if (!match) throw new Error(`failed to locate exported ${name} var (pattern: ${name}:()=>VAR)`);
  return match[1];
}

function findMatchingParen(src, openParenIdx) {
  const s = String(src || "");
  const i0 = Number(openParenIdx) || 0;
  if (i0 < 0 || i0 >= s.length || s[i0] !== "(") throw new Error("findMatchingParen: openParenIdx invalid");

  let depth = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = i0 + 1; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1] || "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "\\") i++;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") i++;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") i++;
      else if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function findStatementTerminatorIndex(src, startIdx, { allowComma = true, label = "statement terminator" } = {}) {
  const s = String(src || "");
  let i = Number(startIdx) || 0;
  if (i < 0) i = 0;
  if (i >= s.length) throw new Error(`failed to locate ${label}: start out of range`);

  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1] || "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "\\") i++;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") i++;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") i++;
      else if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (ch === "{") brace++;
    else if (ch === "}") brace = Math.max(0, brace - 1);

    if (paren === 0 && bracket === 0 && brace === 0) {
      if (ch === ";") return i;
      if (allowComma && ch === ",") return i;
    }
  }

  throw new Error(`failed to locate ${label}`);
}

function findFirstInstantiationOfExportedClass(src, exportName) {
  const classIdent = findExportedFactoryVar(src, exportName);
  const re = new RegExp(`([A-Za-z0-9_$]+)\\s*=\\s*new\\s+${classIdent}\\s*\\(`, "g");
  const match = re.exec(String(src || ""));
  if (!match || typeof match.index !== "number") throw new Error(`failed to locate instantiation: VAR=new ${classIdent}(`);
  const openParenIdx = match.index + match[0].lastIndexOf("(");
  const closeParenIdx = findMatchingParen(src, openParenIdx);
  const terminatorIdx = findStatementTerminatorIndex(src, closeParenIdx + 1, {
    allowComma: false,
    label: `statement terminator after ${exportName} instantiation`
  });
  return { classIdent, varName: match[1], openParenIdx, closeParenIdx, terminatorIdx };
}

module.exports = {
  ensureMarker,
  assertContainsAll,
  assertContainsNone,
  replaceOnce,
  replaceOnceRegex,
  findMatchIndexes,
  injectIntoAsyncMethods,
  injectIntoArrowPropertyFunctions,
  findExportedFactoryVar,
  findFirstInstantiationOfExportedClass,
  findMatchingParen,
  findStatementTerminatorIndex,
  insertBeforeSourceMappingURL
};
