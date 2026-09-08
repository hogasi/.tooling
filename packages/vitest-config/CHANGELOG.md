# @hogasi/vitest-config

## 0.2.0

### Minor Changes

- 677e838: Add `@hogasi/fallow-config`, a shared fallow config that raises every
  advisory rule describing a defect to `error` and opts into fallow's two
  include-required security categories. `@hogasi/vitest-config` now emits the
  `json` coverage reporter so `fallow health --coverage` scores CRAP from
  measured coverage instead of estimating it.

### Patch Changes

- 677e838: Enable coverage for plain `vitest run`, ship TypeScript declarations,
  and declare the optional jsdom peer required by the default environment.
  Node-only consumers can omit jsdom when selecting the node environment.
