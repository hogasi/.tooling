import { includeIgnoreFile } from "@eslint/compat";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import promise from "eslint-plugin-promise";
import unusedImports from "eslint-plugin-unused-imports";
import { defineConfig } from "eslint/config";
import globals from "globals";
import path from "node:path";

import { houseRules } from "./houseRules.js";
import { fileOverrides, svelteOverride } from "./overrides.js";
import { presets } from "./presets.js";

const DEFAULT_PROJECT_FILE_LIMIT = 40;

/**
 * The shared house style, as a flat-config array.
 *
 * It is a function rather than a plain array because the settings below can
 * only be resolved against the consuming repository: the ignore file, the
 * TypeScript project root and default project, the import resolver's project
 * list, and the files allowed outside the project service.
 *
 * @param {object} options
 * @param {string} options.rootDir Absolute path to the repo root, normally
 *   `import.meta.dirname`. The `.gitignore` beside it becomes the ignore list.
 * @param {string} [options.defaultProject] tsconfig used for files matched by
 *   `allowDefaultProject`. Without it those files are typed without
 *   `strictNullChecks`, which silently disables some type-aware rules.
 * @param {string[]} [options.tsconfigProjects] tsconfig globs for the import
 *   resolver.
 * @param {string[]} [options.allowDefaultProject] Files linted without being in
 *   a tsconfig.
 * @param {object} [options.svelteConfig] The repo's resolved `svelte.config.js`.
 */
export default function hogasiConfig({
  allowDefaultProject = [],
  defaultProject,
  rootDir,
  svelteConfig,
  tsconfigProjects = ["./tsconfig.json"]
}) {
  if (!rootDir) {
    throw new Error("@hogasi/eslint-config: `rootDir` is required.");
  }

  return defineConfig(
    // fallow-ignore-next-line security-sink -- rootDir is the caller's own project root, passed from their eslint.config.js; no request input reaches it.
    includeIgnoreFile(path.resolve(rootDir, ".gitignore")),
    // includeIgnoreFile only reads the root .gitignore. Build output ignored by
    // a nested .gitignore has to be repeated here, because linting bundled
    // artifacts breaks the type-aware service.
    { ignores: ["**/out/**", "**/dist/**"] },
    ...presets,
    importResolver(tsconfigProjects),
    baseLayer({ allowDefaultProject, defaultProject, rootDir }),
    svelteOverride(svelteConfig),
    ...fileOverrides
  );
}

const importResolver = (project) => ({
  rules: {
    // Both fire on the common `import x, { x as y }` shape in typed packages.
    "import-x/no-named-as-default": "off",
    "import-x/no-named-as-default-member": "off"
  },
  settings: {
    "import-x/resolver-next": [
      createTypeScriptImportResolver({ alwaysTryTypes: true, project })
    ]
  }
});

const baseLayer = ({ allowDefaultProject, defaultProject, rootDir }) => ({
  languageOptions: {
    globals: { ...globals.browser, ...globals.node },
    parserOptions: {
      ecmaVersion: 2022,
      projectService: {
        allowDefaultProject,
        defaultProject,
        maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING:
          DEFAULT_PROJECT_FILE_LIMIT
      },
      sourceType: "module",
      tsconfigRootDir: rootDir
    }
  },
  plugins: { promise, "unused-imports": unusedImports },
  rules: { ...promise.configs.recommended.rules, ...houseRules }
});
