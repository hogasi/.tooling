import hogasiConfig from "@hogasi/eslint-config";

// This repo lints itself with the config it publishes. A shared config that is
// never run against its own source rots without anyone noticing.
export default [
  ...hogasiConfig({
    rootDir: import.meta.dirname,
    tsconfigProjects: ["./tsconfig.json"]
  }),
  {
    // Product repos test with vitest, which the shared config assumes. This
    // repo cannot: it publishes the vitest config, so it tests itself with
    // Node's built-in runner to avoid depending on what it ships.
    files: ["**/*.test.mjs"],
    rules: { "vitest/no-import-node-test": "off" }
  }
];
