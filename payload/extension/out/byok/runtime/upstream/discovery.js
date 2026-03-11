"use strict";

function getByokUpstreamGlobals() {
  const g = typeof globalThis !== "undefined" ? globalThis : null;
  const u = g && g.__augment_byok_upstream && typeof g.__augment_byok_upstream === "object" ? g.__augment_byok_upstream : null;
  return { global: g, upstream: u };
}

function isObject(v) {
  return v != null && typeof v === "object";
}

function ensureUpstreamBag() {
  const g = typeof globalThis !== "undefined" ? globalThis : null;
  if (!g || typeof g !== "object") return null;
  if (!isObject(g.__augment_byok_upstream)) g.__augment_byok_upstream = {};
  return isObject(g.__augment_byok_upstream) ? g.__augment_byok_upstream : null;
}

function rememberUpstreamCallHost(host, { stream } = {}) {
  if (!isObject(host)) return null;
  const bag = ensureUpstreamBag();
  if (!isObject(bag)) return null;
  const isStream = stream === true;
  if (isStream) bag.callApiStreamHost = host;
  else bag.callApiHost = host;
  bag.callHostCapturedAtMs = Date.now();
  if (typeof host.callApi === "function") bag.callApiOriginal = host.callApi.bind(host);
  if (typeof host.callApiStream === "function") bag.callApiStreamOriginal = host.callApiStream.bind(host);
  return bag;
}

function findDeep(root, predicate, { maxDepth = 6, maxNodes = 5000 } = {}) {
  const start = isObject(root) ? root : null;
  if (!start) return null;
  if (typeof predicate !== "function") return null;
  if (predicate(start)) return start;

  const seen = new Set();
  const q = [{ v: start, d: 0 }];
  let qi = 0;

  const push = (v, d) => {
    if (!isObject(v)) return;
    if (seen.has(v)) return;
    if (seen.size >= maxNodes) return;
    seen.add(v);
    q.push({ v, d });
  };

  while (qi < q.length) {
    const cur = q[qi++];
    const v = cur?.v;
    const d = Number(cur?.d) || 0;
    if (!isObject(v)) continue;
    if (predicate(v)) return v;
    if (d >= maxDepth) continue;

    let keys = [];
    try {
      keys = Object.keys(v);
    } catch {
      keys = [];
    }
    for (const k of keys) {
      let child;
      try {
        child = v[k];
      } catch {
        child = null;
      }
      if (!isObject(child)) continue;
      if (predicate(child)) return child;
      push(child, d + 1);
    }
  }

  return null;
}

function createTimedCache(ttlMs) {
  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Math.floor(Number(ttlMs)) : 0;
  let has = false;
  let cachedValue = null;
  let cachedAtMs = 0;

  const get = () => {
    if (!has) return undefined;
    if (!ttl) return cachedValue;
    if (Date.now() - cachedAtMs < ttl) return cachedValue;
    return undefined;
  };

  const set = (v) => {
    has = true;
    cachedValue = v == null ? null : v;
    cachedAtMs = Date.now();
    return cachedValue;
  };

  return { get, set };
}

function getCachedSingleton({ cache, predicate, directCandidates, deepSearch } = {}) {
  const c = cache && typeof cache.get === "function" && typeof cache.set === "function" ? cache : null;
  if (!c) return null;
  const pred = typeof predicate === "function" ? predicate : null;
  if (!pred) return c.set(null);

  const cached = c.get();
  if (cached !== undefined) return cached;

  const direct = Array.isArray(directCandidates) ? directCandidates : [];
  for (const v of direct) {
    if (pred(v)) return c.set(v);
  }

  const deep = Array.isArray(deepSearch) ? deepSearch : [];
  for (const opts of deep) {
    const o = opts && typeof opts === "object" ? opts : {};
    const found = findDeep(o.root, pred, { ...(o.maxDepth != null ? { maxDepth: o.maxDepth } : {}), ...(o.maxNodes != null ? { maxNodes: o.maxNodes } : {}) });
    if (found) return c.set(found);
  }

  return c.set(null);
}

module.exports = { getByokUpstreamGlobals, findDeep, createTimedCache, getCachedSingleton, rememberUpstreamCallHost };
