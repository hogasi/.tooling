import assert from "node:assert/strict";
import test from "node:test";
import * as prettier from "prettier";

import config from "./index.js";

const format = (source, parser) =>
  prettier.format(source, { ...config, parser });

test("formats with double quotes and no trailing comma", async () => {
  const output = await format("const user = {name:'ana', age:1,}\n", "babel");

  assert.equal(output, 'const user = { name: "ana", age: 1 };\n');
});

test("wraps at 80 columns", async () => {
  const long = `const value = ${"a".repeat(40)} + ${"b".repeat(40)};\n`;
  const output = await format(long, "babel");

  assert.ok(
    output.split("\n").every((line) => line.length <= 80),
    "expected every line to fit in 80 columns"
  );
});

test("wraps prose in markdown", async () => {
  const output = await format(`${"word ".repeat(40)}\n`, "markdown");

  assert.ok(output.split("\n").length > 2, "expected prose to be re-wrapped");
});

test("loads the svelte plugin and puts one attribute per line", async () => {
  const output = await format(
    '<button type="button" class="a" disabled>x</button>\n',
    "svelte"
  );

  assert.match(output, /\n\s+type="button"/);
});
