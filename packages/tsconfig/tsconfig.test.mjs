import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

const resolveConfig = (name) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [tsc, "--showConfig", "-p", `__fixtures__/${name}.json`],
      { cwd: here }
    )
  );

for (const name of ["base", "svelte"]) {
  test(`${name} config is accepted by tsc through the package exports map`, () => {
    assert.equal(resolveConfig(name).compilerOptions.strict, true);
  });
}

test("base config requires explicit type-only imports", () => {
  assert.equal(
    resolveConfig("base").compilerOptions.verbatimModuleSyntax,
    true
  );
});

test("base config leaves emit to the consumer", () => {
  assert.equal(resolveConfig("base").compilerOptions.noEmit, undefined);
});

test("svelte config exposes DOM types", () => {
  assert.deepEqual(resolveConfig("svelte").compilerOptions.lib, [
    "es2022",
    "dom",
    "dom.iterable"
  ]);
});
