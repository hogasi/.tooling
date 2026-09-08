# @hogasi/fallow-config

## 0.2.0

### Minor Changes

- 677e838: Add `@hogasi/fallow-config`, a shared fallow config that raises every
  advisory rule describing a defect to `error` and opts into fallow's two
  include-required security categories. `@hogasi/vitest-config` now emits the
  `json` coverage reporter so `fallow health --coverage` scores CRAP from
  measured coverage instead of estimating it.
