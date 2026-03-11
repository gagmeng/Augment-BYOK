const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  computeByokPackageVersion,
  defaultBuildId,
  sanitizeBuildId,
  stampByokPackageVersion
} = require("../tools/build/build-vsix");

test("build-vsix version: defaultBuildId uses UTC timestamp shape", () => {
  const out = defaultBuildId(new Date("2026-03-06T09:08:07.000Z"));
  assert.equal(out, "20260306090807");
});

test("build-vsix version: sanitizeBuildId keeps semver-safe identifier", () => {
  assert.equal(sanitizeBuildId(" Feature Flags / DnIlfDUr "), "feature-flags-dnilfdur");
});

test("build-vsix version: computeByokPackageVersion adds byok prerelease", () => {
  const out = computeByokPackageVersion("0.801.0", { buildId: "20260306090807" });
  assert.equal(out, "0.801.0-byok.20260306090807");
});

test("build-vsix version: stampByokPackageVersion rewrites unpacked extension package", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "augment-byok-build-version-"));
  try {
    const pkgPath = path.join(dir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify({ name: "vscode-augment", version: "0.801.0" }, null, 2));
    const res = stampByokPackageVersion(pkgPath, { upstreamVersion: "0.801.0", buildId: "abc123" });
    assert.equal(res.version, "0.801.0-byok.abc123");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    assert.equal(pkg.version, "0.801.0-byok.abc123");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
