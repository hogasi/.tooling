import { ESLint } from "eslint";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import hogasiConfig from "./index.js";

// A config file name keeps the fixture out of the type-aware project service,
// so the config can be exercised without a TypeScript program.
const FIXTURE = "sample.config.js";
const OFFENDING_SOURCE = `export function summarise(alpha, beta, gamma, delta) {
  console.log(alpha == beta);
  return gamma + delta;
}
`;

const COMMENT_FIXTURE = "comments.config.js";
const COMMENT_SOURCE = `// silviu: one pass only; shard if this ever runs per-request
// Resolved here because the plugin loads from the consumer's directory.
export const total = 1 + 2; // adds them up
// TODO: rename this
`;

const rootDir = mkdtempSync(path.join(tmpdir(), "hogasi-eslint-"));
writeFileSync(path.join(rootDir, ".gitignore"), "generated/\n");
writeFileSync(path.join(rootDir, FIXTURE), OFFENDING_SOURCE);
writeFileSync(path.join(rootDir, COMMENT_FIXTURE), COMMENT_SOURCE);
mkdirSync(path.join(rootDir, "generated"));
writeFileSync(path.join(rootDir, "generated", FIXTURE), OFFENDING_SOURCE);

after(() => {
  rmSync(rootDir, { force: true, recursive: true });
});

const lint = () =>
  new ESLint({
    cwd: rootDir,
    overrideConfig: hogasiConfig({ rootDir }),
    overrideConfigFile: true
  });

test("reports the house rules on an offending file", async () => {
  const [result] = await lint().lintFiles([FIXTURE]);
  const reported = new Set(result.messages.map((message) => message.ruleId));

  for (const rule of ["no-console", "max-params", "eqeqeq"]) {
    assert.ok(reported.has(rule), `expected ${rule} to be reported`);
  }
});

test("honours the repo .gitignore through rootDir", async () => {
  const isIgnored = await lint().isPathIgnored(path.join("generated", FIXTURE));

  assert.equal(isIgnored, true);
});

test("refuses to build without a rootDir", () => {
  assert.throws(() => hogasiConfig({}), /rootDir/);
});

test("rejects comments that restate code or defer work", async () => {
  const [result] = await lint().lintFiles([COMMENT_FIXTURE]);
  const reported = result.messages.map((message) => message.ruleId);

  assert.deepEqual(
    new Set(reported),
    new Set(["no-inline-comments", "no-warning-comments"])
  );
});

test("leaves a why-comment and a silviu: ceiling marker alone", async () => {
  const [result] = await lint().lintFiles([COMMENT_FIXTURE]);
  const flaggedLines = new Set(result.messages.map(({ line }) => line));

  assert.equal(flaggedLines.has(1), false, "silviu: marker was flagged");
  assert.equal(flaggedLines.has(2), false, "why-comment was flagged");
});
