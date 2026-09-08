const FULL_COVERAGE = 100;

// Nothing here carries testable logic, so counting it would only let real gaps
// hide behind a padded denominator.
const ALWAYS_EXCLUDED = [
  "**/*.{test,spec}.{ts,js,mjs}",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/*.d.ts",
  "**/types/**"
];

const TEST_FILES = [
  "src/**/*.{test,spec}.{ts,js}",
  "src/**/*.svelte.{test,spec}.{ts,js}"
];

/**
 * The shared Vitest `test` block.
 *
 * It returns only the `test` options, never a whole config. Plugins and
 * aliases resolve against the consuming repo's own Vite version, so a shared
 * package that owned them would either pin the wrong copy of
 * `@sveltejs/vite-plugin-svelte` or force every non-Svelte repo to install it.
 *
 * @param {object} options
 * @param {string[]} options.coverageInclude The source the coverage gate
 *   applies to. Required: with no include list, v8 counts whatever happened to
 *   be imported, so the percentage stops meaning anything.
 * @param {number|false} [options.coverageThreshold] Percentage every metric
 *   must reach, or `false` to collect coverage without gating on it.
 * @param {string} [options.environment] Vitest environment.
 * @param {string[]} [options.setupFiles] Files run before each test file.
 * @param {string[]} [options.coverageExclude] Extra paths to leave out of the
 *   coverage denominator, on top of tests, mocks and type-only files.
 */
export default function hogasiVitest({
  coverageExclude = [],
  coverageInclude,
  coverageThreshold = FULL_COVERAGE,
  environment = "jsdom",
  setupFiles = []
}) {
  if (!Array.isArray(coverageInclude) || coverageInclude.length === 0) {
    throw new TypeError(
      "@hogasi/vitest-config: `coverageInclude` must be a non-empty array."
    );
  }

  return {
    coverage: {
      enabled: true,
      exclude: [...ALWAYS_EXCLUDED, ...coverageExclude],
      include: coverageInclude,
      provider: "v8",
      // `json` writes coverage/coverage-final.json in Istanbul format, which
      // is what `fallow health --coverage` needs to score CRAP from measured
      // coverage instead of estimating unexported helpers as untested.
      reporter: ["json", "text"],
      thresholds: thresholdsFor(coverageThreshold)
    },
    environment,
    include: TEST_FILES,
    setupFiles
  };
}

/**
 * Vitest only understands `{ 100: true }` as a shorthand for "every metric at
 * 100". Any other target has to name each metric explicitly.
 */
const thresholdsFor = (threshold) => {
  if (threshold === false) {
    // No `thresholds` key at all, which is how Vitest is told to report
    // coverage without gating on it.
    return;
  }

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError(
      "@hogasi/vitest-config: `coverageThreshold` must be false or 0-100."
    );
  }

  return threshold === FULL_COVERAGE
    ? { [FULL_COVERAGE]: true }
    : {
        branches: threshold,
        functions: threshold,
        lines: threshold,
        statements: threshold
      };
};
