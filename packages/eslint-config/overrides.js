import vitest from "@vitest/eslint-plugin";
import ts from "typescript-eslint";

/**
 * File-scoped relaxations of the house rules.
 *
 * `svelteOverride` is a function because it is the only block that needs the
 * consuming repo's resolved `svelte.config.js`.
 */
export const svelteOverride = (svelteConfig) => ({
  files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
  languageOptions: {
    parserOptions: {
      extraFileExtensions: [".svelte"],
      parser: ts.parser,
      projectService: true,
      svelteConfig
    }
  },
  rules: { "svelte/button-has-type": "error" }
});

const testOverride = {
  files: [
    "**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}",
    "**/*.svelte.{test,spec}.{ts,js,mjs}"
  ],
  plugins: { vitest },
  rules: {
    ...vitest.configs.recommended.rules,
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-floating-promises": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "max-lines": "off",
    "max-lines-per-function": "off",
    "no-console": "off",
    // Tests legitimately build paths from a temp directory.
    "security/detect-non-literal-fs-filename": "off",
    "security/detect-object-injection": "off",
    "unicorn/consistent-function-scoping": "off",
    "unicorn/no-await-expression-member": "off"
  }
};

// Config and script files don't need type-aware linting. Opting them out of the
// project service entirely avoids a cold-start "not found by the project
// service" failure in CI that allowDefaultProject alone hits.
const configFileOverride = {
  files: [
    "**/*.config.{js,ts,cjs,mjs}",
    "**/svelte.config.js",
    "**/scripts/**/*.{js,ts,cjs,mjs}",
    "eslint.config.js"
  ],
  languageOptions: { parserOptions: { projectService: false } },
  rules: {
    ...ts.configs.disableTypeChecked.rules,
    "import-x/no-default-export": "off",
    "max-lines": "off"
  }
};

const scriptOverride = {
  files: ["**/scripts/**/*.{js,mjs,ts}"],
  rules: {
    "max-lines": "off",
    "max-lines-per-function": "off",
    "no-console": "off",
    "perfectionist/sort-modules": "off",
    "security/detect-non-literal-fs-filename": "off",
    "unicorn/no-process-exit": "off"
  }
};

const fixtureOverride = {
  files: [
    "**/*.mock.*",
    "**/__tests__/**",
    "**/__stories__/**",
    "**/stubs/**",
    "**/playwright.config.ts"
  ],
  rules: {
    "@typescript-eslint/no-floating-promises": "off",
    "max-lines-per-function": "off",
    "perfectionist/sort-objects": "off"
  }
};

export const fileOverrides = [
  testOverride,
  configFileOverride,
  scriptOverride,
  fixtureOverride
];
