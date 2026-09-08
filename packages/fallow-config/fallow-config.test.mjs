import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test, { after } from "node:test";

// Resolved rather than taken from PATH: `node --test` runs from the repo
// root, where node_modules/.bin is not on it.
const require_ = createRequire(import.meta.url);
const fallowBin = path.join(
  path.dirname(require_.resolve("fallow/package.json")),
  require_("fallow/package.json").bin.fallow
);

const repoRoot = path.resolve(import.meta.dirname, "../..");

const runFallow = (...args) =>
  JSON.parse(
    execFileSync(fallowBin, args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .trim()
      .split("\n")
      .at(-1)
  );

test("scans every security category fallow knows about", () => {
  const catalogue = runFallow("schema").security_categories.categories;
  const { include } = runFallow("config").security.categories;

  assert.deepEqual(
    new Set(include),
    new Set(catalogue.map(({ id }) => id)),
    "fallow's catalogue changed; update base.jsonc so the whitelist still admits every category"
  );
});

test("admits the two categories that only run from an include list", () => {
  const { include } = runFallow("config").security.categories;

  assert.ok(include.includes("hardcoded-secret"));
  assert.ok(include.includes("secret-to-network"));
});

test("gates on the rules fallow ships as advisory", () => {
  const { rules } = runFallow("config");

  for (const rule of [
    "dev-dependencies-in-production",
    "re-export-cycle",
    "require-suppression-reason",
    "security-client-server-leak",
    "security-sink",
    "stale-suppressions",
    "unused-dev-dependencies",
    "unused-optional-dependencies"
  ]) {
    assert.equal(rules[rule], "error", `${rule} must gate, not warn`);
  }
});

// A gate that reports nothing passes CI for the same reason a clean repo does.
// These prove the two commands `pnpm check` runs actually exit non-zero.

const OFFENDING = `import { execSync } from "node:child_process";

export function tangled(items, first, second, third) {
  let total = 0;
  for (const item of items) {
    if (item > 1) {
      if (first && second) {
        while (total < 5) {
          if (third || item === 3) {
            total += item;
          } else if (item === 4) {
            total -= 1;
          } else {
            total = first ? total + 1 : total - 1;
          }
        }
      } else if (second) {
        total += 2;
      }
    }
  }
  return total;
}

export const listing = (userInput) => execSync(\`ls \${userInput}\`);
`;

// fallow rejects an absolute `extends`, so the fixture has to sit next to the
// config it inherits rather than in the system temp directory.
const fixtureRoot = mkdtempSync(path.join(import.meta.dirname, "tmp-fixture-"));

writeFileSync(
  path.join(fixtureRoot, "package.json"),
  JSON.stringify({
    exports: "./index.js",
    name: "fixture",
    type: "module",
    version: "0.0.0"
  })
);
writeFileSync(path.join(fixtureRoot, "index.js"), OFFENDING);
writeFileSync(
  path.join(fixtureRoot, ".fallowrc.json"),
  JSON.stringify({ extends: ["../base.jsonc"] })
);

after(() => {
  rmSync(fixtureRoot, { force: true, recursive: true });
});

const runGate = (...args) =>
  spawnSync(fallowBin, [...args, "--root", fixtureRoot], { encoding: "utf8" });

test("the health gate fails on a function past the cognitive ceiling", () => {
  const { status, stdout } = runGate("health");

  assert.equal(status, 1, stdout);
  assert.match(stdout, /cognitive/i);
});

test("the security gate fails on a command-injection sink", () => {
  const { status, stdout } = runGate("security", "--fail-on-issues");

  assert.equal(status, 1, stdout);
  assert.match(stdout, /command injection/i);
});
