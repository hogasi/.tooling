/**
 * Shared Prettier configuration.
 *
 * Plugins are resolved to absolute URLs here rather than named as bare
 * specifiers. Prettier resolves a bare plugin name from the *consumer's*
 * directory, where these packages are not installed; resolving from this file
 * finds the copies this package actually depends on.
 *
 * `prettier-plugin-tailwindcss` must stay last: it sorts class attributes after
 * every other plugin has finished rewriting them.
 */
export default {
  bracketSameLine: false,
  endOfLine: "lf",
  overrides: [{ files: "*.svelte", options: { parser: "svelte" } }],
  plugins: [
    import.meta.resolve("prettier-plugin-svelte"),
    import.meta.resolve("prettier-plugin-tailwindcss")
  ],
  printWidth: 80,
  proseWrap: "always",
  quoteProps: "consistent",
  singleAttributePerLine: true,
  singleQuote: false,
  svelteAllowShorthand: true,
  svelteIndentScriptAndStyle: true,
  svelteSortOrder: "options-scripts-markup-styles",
  tabWidth: 2,
  trailingComma: "none",
  useTabs: false
};
