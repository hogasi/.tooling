import type { InlineConfig } from "vitest/node";

/**
Shared test options with coverage enabled, defaulting to jsdom and 100%.
*/
export default function hogasiVitest(options: {
  readonly coverageExclude?: string[];
  readonly coverageInclude: string[];
  readonly coverageThreshold?: false | number;
  readonly environment?: InlineConfig["environment"];
  readonly setupFiles?: string[];
}): Pick<InlineConfig, "coverage" | "environment" | "include" | "setupFiles">;
