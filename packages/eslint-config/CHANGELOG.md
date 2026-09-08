# @hogasi/eslint-config

## 0.2.0

### Minor Changes

- 677e838: Error on `no-inline-comments` and `no-warning-comments`. Comments
  beside code usually restate it, and `TODO`/`FIXME` markers hide deferred work
  outside the issue tracker. `silviu:` ceiling markers, JSDoc and standalone
  why-comments are unaffected.
- 677e838: Turn off `unicorn/name-replacements`, the half of
  `prevent-abbreviations` that unicorn 74 split out. Narrow the `typescript`
  peer range to `>=5.9.3 <6.1.0`, matching typescript-eslint's own bound: it
  throws on import under TypeScript 7 rather than degrading.

### Patch Changes

- 677e838: Add `@hogasi/fallow-config`, a shared fallow config that raises every
  advisory rule describing a defect to `error` and opts into fallow's two
  include-required security categories. `@hogasi/vitest-config` now emits the
  `json` coverage reporter so `fallow health --coverage` scores CRAP from
  measured coverage instead of estimating it.
