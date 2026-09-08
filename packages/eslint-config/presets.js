import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import perfectionist from "eslint-plugin-perfectionist";
import security from "eslint-plugin-security";
import svelte from "eslint-plugin-svelte";
import unicorn from "eslint-plugin-unicorn";
import ts from "typescript-eslint";

/**
 * The upstream presets the house style builds on, in application order.
 * `prettier` and `svelte.configs.prettier` come last so they can switch off
 * every stylistic rule the presets before them turned on.
 */
export const presets = [
  js.configs.recommended,
  ts.configs.strict,
  ts.configs.stylistic,
  svelte.configs.recommended,
  unicorn.configs["flat/recommended"],
  security.configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  perfectionist.configs["recommended-natural"],
  prettier,
  svelte.configs.prettier
];
