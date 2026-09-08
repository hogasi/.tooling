import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import hogasiVitest from "./index.js";

// Resolved rather than taken from PATH: `node --test` runs from the repo
// root, where node_modules/.bin is not on it.
const require_ = createRequire(import.meta.url);
const vitestBin = path.join(
  path.dirname(require_.resolve("vitest/package.json")),
  require_("vitest/package.json").bin.vitest
);

test("gates every metric at 100 by default", () => {
  const { coverage } = hogasiVitest({ coverageInclude: ["src/**"] });

  assert.deepEqual(coverage.thresholds, { 100: true });
});

test("names each metric when the target is below 100", () => {
  const { coverage } = hogasiVitest({
    coverageInclude: ["src/**"],
    coverageThreshold: 95
  });

  assert.deepEqual(coverage.thresholds, {
    branches: 95,
    functions: 95,
    lines: 95,
    statements: 95
  });
});

test("writes Istanbul coverage that fallow can score CRAP from", () => {
  const { coverage } = hogasiVitest({ coverageInclude: ["src/**"] });

  assert.ok(
    coverage.reporter.includes("json"),
    "fallow health --coverage needs coverage-final.json"
  );
});

test("collects coverage without gating when the threshold is false", () => {
  const { coverage } = hogasiVitest({
    coverageInclude: ["src/**"],
    coverageThreshold: false
  });

  assert.equal(coverage.thresholds, undefined);
  assert.equal(coverage.provider, "v8");
});

test("keeps tests and type-only files out of the denominator", () => {
  const { coverage } = hogasiVitest({
    coverageExclude: ["src/generated/**"],
    coverageInclude: ["src/**"]
  });

  assert.ok(coverage.exclude.includes("**/*.d.ts"));
  assert.ok(coverage.exclude.includes("src/generated/**"));
});

test("refuses to build without an explicit coverage include", () => {
  assert.throws(() => hogasiVitest({}), /coverageInclude/);
  assert.throws(() => hogasiVitest({ coverageInclude: [] }), /coverageInclude/);
});

test("rejects a threshold outside 0-100", () => {
  assert.throws(
    () => hogasiVitest({ coverageInclude: ["src/**"], coverageThreshold: 120 }),
    /0-100/
  );
});

// The two threshold shapes above are only useful if Vitest accepts them. This
// runs the real binary against a half-covered fixture: the shorthand is easy to
// get subtly wrong, and a wrong one is silently ignored rather than rejected.
// The fixture lives inside the package, not the system temp directory: a
// config file outside the workspace cannot resolve `vitest/config`.
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = mkdtempSync(path.join(here, "tmp-fixture-"));

after(() => {
  rmSync(fixture, { force: true, recursive: true });
});

const write = (relative, contents) =>
  writeFileSync(path.join(fixture, relative), contents);

const packageDir = path.join(fixture, "node_modules/@hogasi/vitest-config");
mkdirSync(packageDir, { recursive: true });
execFileSync("pnpm", ["pack", "--pack-destination", fixture], {
  cwd: here,
  stdio: "pipe"
});
const { version } = JSON.parse(
  readFileSync(path.join(here, "package.json"), "utf8")
);
execFileSync("tar", [
  "-xzf",
  path.join(fixture, `hogasi-vitest-config-${version}.tgz`),
  "-C",
  packageDir,
  "--strip-components=1"
]);
write("package.json", JSON.stringify({ name: "consumer", type: "module" }));
mkdirSync(path.join(fixture, "src"));
write(
  "src/math.js",
  `export const classify = (n) => {
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "zero";
};
`
);
write(
  "src/math.test.js",
  `import { expect, test } from "vitest";
import { classify } from "./math.js";

test("positive", () => {
  expect(classify(1)).toBe("positive");
});
`
);

const runVitest = ({ coverageThreshold = 100, environment = "node" } = {}) => {
  write(
    "vitest.config.js",
    `import { defineConfig } from "vitest/config";
import hogasiVitest from "@hogasi/vitest-config";

export default defineConfig({
  test: {
    ...hogasiVitest({
      coverageInclude: ["src/**"],
      coverageThreshold: ${JSON.stringify(coverageThreshold)},
      environment: ${JSON.stringify(environment)}
    })
  }
});
`
  );

  return spawnSync(process.execPath, [vitestBin, "run", "--root", fixture], {
    encoding: "utf8",
    env: { ...process.env, CI: "true" }
  });
};

test("the default gate fails a half-covered source tree without CLI flags", () => {
  const { status, stderr, stdout } = runVitest();

  assert.equal(status, 1, stdout + stderr);
  assert.match(stderr, /does not meet global threshold/);
});

test("a gate the code clears passes", () => {
  const { status, stderr, stdout } = runVitest({ coverageThreshold: 20 });

  assert.equal(status, 0, stdout + stderr);
});

test("disabling the threshold still writes measured coverage", () => {
  rmSync(path.join(fixture, "coverage"), { force: true, recursive: true });

  const { status, stderr, stdout } = runVitest({ coverageThreshold: false });

  assert.equal(status, 0, stdout + stderr);
  const coverage = JSON.parse(
    readFileSync(path.join(fixture, "coverage/coverage-final.json"), "utf8")
  );
  assert.ok(
    Object.keys(coverage).some((file) => file.endsWith("/src/math.js"))
  );
});

test("the default environment provides the DOM", () => {
  write(
    "src/dom.test.js",
    `import { expect, it } from "vitest";
it("should provide the DOM", () => {
  const button = document.createElement("button");
  button.textContent = "Save";
  expect(button.textContent).toBe("Save");
});`
  );
  write(
    "vitest.config.js",
    `import hogasiVitest from "@hogasi/vitest-config";
export default { test: hogasiVitest({ coverageInclude: ["src/math.js"], coverageThreshold: false }) };`
  );

  const { status, stderr, stdout } = spawnSync(
    process.execPath,
    [vitestBin, "run", "--root", fixture],
    {
      encoding: "utf8",
      env: { ...process.env, CI: "true" }
    }
  );

  assert.equal(status, 0, stdout + stderr);
});

test("the packed package supports strict TypeScript config consumers", () => {
  write(
    "consumer.ts",
    `import hogasiVitest from "@hogasi/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { ...hogasiVitest({ coverageInclude: ["src/**"], coverageThreshold: false }) } });
// @ts-expect-error coverageInclude is required.
hogasiVitest({});
// @ts-expect-error thresholds must be a number or false.
hogasiVitest({ coverageInclude: ["src/**"], coverageThreshold: "95" });
`
  );
  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        module: "esnext",
        moduleResolution: "bundler",
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: "es2022"
      },
      files: ["consumer.ts"]
    })
  );

  const { status, stderr, stdout } = spawnSync(
    process.execPath,
    [
      require_.resolve("typescript/bin/tsc"),
      "-p",
      path.join(fixture, "tsconfig.json")
    ],
    { encoding: "utf8" }
  );

  assert.equal(status, 0, stdout + stderr);
});
