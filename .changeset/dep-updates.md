---
"@hogasi/eslint-config": minor
---

Turn off `unicorn/name-replacements`, the half of `prevent-abbreviations` that
unicorn 74 split out. Narrow the `typescript` peer range to `>=5.9.3 <6.1.0`,
matching typescript-eslint's own bound: it throws on import under TypeScript 7
rather than degrading.
