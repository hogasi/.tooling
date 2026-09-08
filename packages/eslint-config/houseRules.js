/**
 * The rules that make this style ours rather than the presets' defaults.
 * Kept as data so the entry point stays readable.
 */
export const houseRules = {
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { fixStyle: "inline-type-imports", prefer: "type-imports" }
  ],
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/no-unused-vars": "off",
  "@typescript-eslint/prefer-nullish-coalescing": "error",
  "complexity": ["error", 8],
  "curly": "error",
  "eqeqeq": ["error", "always"],
  // Conventional one-letter names: colour channels, coordinates, indices.
  "id-length": [
    "error",
    { exceptions: ["_", "b", "e", "g", "i", "j", "p", "r", "x", "y"] }
  ],
  "max-depth": ["error", 3],
  "max-lines": [
    "error",
    { max: 300, skipBlankLines: true, skipComments: true }
  ],
  "max-lines-per-function": [
    "error",
    { max: 30, skipBlankLines: true, skipComments: true }
  ],
  "max-params": ["error", 3],
  "no-console": "error",
  // A comment beside a line of code almost always restates it. An explanation
  // that earns its place explains *why*, and needs its own line to do it.
  "no-inline-comments": "error",
  "no-nested-ternary": "error",
  "no-param-reassign": "error",
  "no-undef": "off",
  // Deferred work belongs in an issue, where it is visible and assigned.
  // `silviu:` markers are untouched: they record a deliberate ceiling and the
  // trigger to raise it, which is a decision rather than a reminder.
  "no-warning-comments": [
    "error",
    { location: "anywhere", terms: ["fixme", "todo", "xxx"] }
  ],
  "perfectionist/sort-imports": [
    "error",
    { newlinesBetween: 1, order: "asc", type: "natural" }
  ],
  "perfectionist/sort-objects": ["error", { order: "asc", type: "natural" }],
  "unicorn/filename-case": [
    "error",
    { cases: { camelCase: true, kebabCase: true, pascalCase: true } }
  ],
  // The other half of `prevent-abbreviations` after unicorn 74 split it.
  // Expanding `rootDir` to `rootDirectory` or `args` to `arguments_` makes
  // names longer without making them clearer.
  "unicorn/name-replacements": "off",
  "unicorn/no-null": "off",
  "unicorn/prevent-abbreviations": "off",
  "unused-imports/no-unused-imports": "error",
  "unused-imports/no-unused-vars": [
    "error",
    {
      args: "after-used",
      argsIgnorePattern: "^_",
      vars: "all",
      varsIgnorePattern: "^_"
    }
  ]
};
