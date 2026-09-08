import { ESLint } from "eslint";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import { houseRules } from "./houseRules.js";
import hogasiConfig from "./index.js";

// A rule can be configured and still never fire: a preset can switch it off, a
// parser option can make the plugin bail, an upgrade can rename it. Severity
// assertions do not catch any of that, so every enabled rule gets a file that
// breaks it and has to be reported.

const longBody = Array.from(
  { length: 40 },
  (_, index) => `  const v${index} = ${index};`
).join("\n");

// Every fixture sits inside the fixture tsconfig, so it is linted through the
// same type-aware path a real source file takes. Naming them `*.config.js`
// would have been easier and wrong: the shared config switches `max-lines` off
// for config files, so that rule would have looked inert.
const PLAIN_FIXTURES = [
  [
    "complexity",
    "complexity.js",
    `export function f(n) {\n${Array.from({ length: 9 }, (_, index) => `  if (n === ${index}) { return ${index}; }`).join("\n")}\n  return -1;\n}\n`
  ],
  [
    "curly",
    "curly.js",
    "export function f(n) {\n  if (n) return 1;\n  return 0;\n}\n"
  ],
  [
    "eqeqeq",
    "eqeqeq.js",
    "export const same = (left, right) => left == right;\n"
  ],
  ["id-length", "idLength.js", "export const a = 1;\n"],
  [
    "max-depth",
    "maxDepth.js",
    "export function f(n) {\n  if (n) {\n    if (n) {\n      if (n) {\n        if (n) { return 1; }\n      }\n    }\n  }\n  return 0;\n}\n"
  ],
  [
    "max-lines",
    "maxLines.js",
    `${Array.from({ length: 350 }, (_, index) => `export const value${index} = ${index};`).join("\n")}\n`
  ],
  [
    "max-lines-per-function",
    "maxLinesPerFunction.js",
    `export function f() {\n${longBody}\n  return 0;\n}\n`
  ],
  [
    "max-params",
    "maxParams.js",
    "export const f = (one, two, three, four) => one + two + three + four;\n"
  ],
  ["no-console", "noConsole.js", "export const f = () => console.log(1);\n"],
  [
    "no-inline-comments",
    "noInlineComments.js",
    "export const total = 1; // adds up\n"
  ],
  [
    "no-nested-ternary",
    "noNestedTernary.js",
    "export const f = (n) => (n ? (n > 1 ? 1 : 2) : 3);\n"
  ],
  [
    "no-param-reassign",
    "noParamReassign.js",
    "export function f(count) {\n  count = count + 1;\n  return count;\n}\n"
  ],
  [
    "no-warning-comments",
    "noWarningComments.js",
    "// TODO: rename this\nexport const total = 1;\n"
  ],
  [
    "perfectionist/sort-imports",
    "sortImports.js",
    "import zebra from 'zebra';\nimport alpha from 'alpha';\n\nexport const both = [alpha, zebra];\n"
  ],
  [
    "perfectionist/sort-objects",
    "sortObjects.js",
    "export const shape = { zebra: 1, alpha: 2 };\n"
  ],
  ["unicorn/filename-case", "bad_file_name.js", "export const total = 1;\n"],
  [
    "unused-imports/no-unused-imports",
    "unusedImports.js",
    "import path from 'node:path';\n\nexport const total = 1;\n"
  ],
  [
    "unused-imports/no-unused-vars",
    "unusedVars.js",
    "export function f() {\n  const unusedValue = 1;\n  return 0;\n}\n"
  ]
];

// The test override once matched only `.ts` and `.js`, so `.mjs` suites silently
// got none of these relaxations. Every extension it claims to cover is checked.
const RELAXED_IN_TESTS = ["max-lines-per-function", "no-console"];
const TEST_FILE_NAMES = ["sample.test.ts", "sample.test.js", "sample.spec.mjs"];
const TEST_SOURCE = `export function noisy() {\n  console.log(1);\n${longBody}\n}\n`;

// These need type information, so they live in a real TypeScript program.
const TYPED_FIXTURES = [
  [
    "@typescript-eslint/consistent-type-imports",
    "consistentTypeImports.ts",
    "import { Shape } from './shape.js';\n\nexport const render = (shape: Shape): string => shape.name;\n"
  ],
  [
    "@typescript-eslint/no-floating-promises",
    "noFloatingPromises.ts",
    "export function f(): void {\n  Promise.resolve(1);\n}\n"
  ],
  [
    "@typescript-eslint/no-misused-promises",
    "noMisusedPromises.ts",
    "export function f(): number {\n  if (Promise.resolve(1)) { return 1; }\n  return 0;\n}\n"
  ],
  [
    "@typescript-eslint/prefer-nullish-coalescing",
    "preferNullishCoalescing.ts",
    "export const f = (value: string | undefined): string => value || 'fallback';\n"
  ]
];

const rootDir = mkdtempSync(path.join(tmpdir(), "hogasi-rules-"));
const write = (name, source) => writeFileSync(path.join(rootDir, name), source);

write(".gitignore", "generated/\n");
write(
  "tsconfig.json",
  JSON.stringify({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      module: "esnext",
      moduleResolution: "bundler",
      noEmit: true,
      strict: true,
      target: "es2022"
    },
    include: ["*.js", "*.ts"]
  })
);
write("shape.ts", "export interface Shape {\n  name: string;\n}\n");
for (const [, name, source] of [...PLAIN_FIXTURES, ...TYPED_FIXTURES]) {
  write(name, source);
}
for (const name of TEST_FILE_NAMES) {
  write(name, TEST_SOURCE);
}

const eslint = new ESLint({
  cwd: rootDir,
  overrideConfig: hogasiConfig({
    rootDir,
    tsconfigProjects: ["./tsconfig.json"]
  }),
  overrideConfigFile: true
});
const results = await eslint.lintFiles(["*.js", "*.ts", "*.mjs"]);

const reportsByFile = new Map(
  results.map((result) => [
    path.basename(result.filePath),
    new Set(
      result.messages.map(
        (message) => message.ruleId ?? `FATAL: ${message.message}`
      )
    )
  ])
);

after(() => {
  rmSync(rootDir, { force: true, recursive: true });
});

for (const [rule, file] of [...PLAIN_FIXTURES, ...TYPED_FIXTURES]) {
  test(`${rule} reports the code that breaks it`, () => {
    const reported = reportsByFile.get(file);

    assert.ok(reported, `${file} was never linted`);
    assert.ok(
      reported.has(rule),
      `${rule} never fired; ${file} reported ${[...reported].join(", ") || "nothing"}`
    );
  });
}

test("every enabled house rule has a fixture proving it fires", () => {
  const covered = new Set(
    [...PLAIN_FIXTURES, ...TYPED_FIXTURES].map(([rule]) => rule)
  );
  const enabled = Object.entries(houseRules)
    .filter(([, value]) => (Array.isArray(value) ? value[0] : value) !== "off")
    .map(([rule]) => rule);

  assert.deepEqual(
    new Set(enabled.filter((rule) => !covered.has(rule))),
    new Set()
  );
});

for (const file of TEST_FILE_NAMES) {
  test(`${file} gets the test-file relaxations`, () => {
    const reported = reportsByFile.get(file);

    assert.ok(reported, `${file} was never linted`);
    for (const rule of RELAXED_IN_TESTS) {
      assert.equal(
        reported.has(rule),
        false,
        `${rule} still applies in ${file}`
      );
    }
  });
}
