# .tooling

Shared configuration packages for the `hogasi` org. The build plan and the
reasoning behind each decision live in [PLAN.md](PLAN.md).

## The contract

Every repo exposes the same script names, and the tooling only ever calls those:

```
pnpm check · pnpm build · pnpm test:e2e
```

`check` is one aggregate covering every gate that must pass: format, lint,
typecheck, dead code, complexity, security and tests. Keeping it as a single
script lets a repo add a gate without changing anything shared.

The repo also needs a `.nvmrc`, which is where the Node version lives.

Reusable workflows and the composite setup action were removed until there is a
second repo to consume them. Their design is recorded in [PLAN.md](PLAN.md), so
it can come back without being redesigned.

## Consuming it

`tsconfig.json`, with a browser variant that adds the DOM libraries:

```json
{ "extends": "@hogasi/tsconfig/base" }
```

```json
{ "extends": "@hogasi/tsconfig/svelte" }
```

The base sets no `lib`, no `types` and no `noEmit`, so each consumer still
declares what it targets, what ambient types it needs, and whether it emits.

Prettier is referenced from `package.json`, replacing any local `.prettierrc`:

```json
{ "prettier": "@hogasi/prettier-config" }
```

`.prettierignore` stays per repo, because Prettier does not read an ignore list
from a shared config.

ESLint is a function, not an array. Four settings can only be resolved against
the consuming repo, so they are passed in and everything else is shared:

```js
import hogasi from "@hogasi/eslint-config";
import { defineConfig } from "eslint/config";

import svelteConfig from "./svelte.config.js";

export default defineConfig(
  ...hogasi({
    allowDefaultProject: ["eslint.config.js"],
    rootDir: import.meta.dirname,
    svelteConfig,
    tsconfigProjects: ["./tsconfig.json", "./apps/*/tsconfig.json"]
  })
  // Repo-specific overrides go here, after the shared blocks.
);
```

`rootDir` supplies both the TypeScript project root and the `.gitignore` used as
the ignore list. It is required, and the config throws without it.

Install Vitest and its coverage provider alongside the shared config. The
default environment also requires `jsdom`; Node-only consumers can omit it and
pass `environment: "node"`:

```sh
pnpm add -D @hogasi/vitest-config vitest @vitest/coverage-v8 jsdom
```

Vitest, in `vitest.config.ts`. The package exports the typed `test` block only,
so plugins and aliases stay with the repo that owns them:

```ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import hogasiVitest from "@hogasi/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  test: {
    ...hogasiVitest({
      coverageInclude: ["src/lib/**/*.{ts,svelte}"],
      setupFiles: ["./vitest-setup.ts"]
    })
  }
});
```

`coverageInclude` is required: without it, v8 measures whatever happened to be
imported and the percentage stops meaning anything. The coverage gate is 100% by
default, including with plain `vitest run`. Pass `coverageThreshold: 95` for a
lower bar, or `false` to report coverage without gating on it.

The config also errors on `no-inline-comments` and `no-warning-comments`: a
comment beside a line of code almost always restates it, and a `TODO` is
deferred work with nobody assigned. `silviu:` markers are deliberately not
caught — they record a chosen ceiling and the trigger to raise it. Standalone
why-comments, JSDoc and lint suppressions all stay legal.

Dead code, complexity and security, in `.fallowrc.jsonc`:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",
  "extends": ["npm:@hogasi/fallow-config"],
  "entry": ["src/routes/**"],
  "ignoreDependencies": ["@hogasi/fallow-config"]
}
```

Install `fallow` and `@hogasi/fallow-config`, then make `check` run both gates:

```json
"check": "pnpm lint && fallow && fallow security --fail-on-issues && vitest run"
```

Bare `fallow` is dead code, duplication and health in one pass, and it exits
non-zero on any finding. `security` is a separate command because its findings
are candidates for a human to verify, and it never surfaces under the other
commands — which also means it gates nowhere unless you run it.

The shared config raises every rule that describes a defect from `warn`, which
exits 0 and gates nothing, to `error`. It also opts into fallow's two
include-required security categories, `hardcoded-secret` and
`secret-to-network`. Doing that means naming all 46 categories, because
`include` is a whitelist that drops everything left out rather than an addition
— so the package carries a test that fails if fallow's catalogue and the list
ever diverge.

Complexity is split deliberately. ESLint already caps cyclomatic complexity at
8, function length at 30 code lines and nesting at 3, so fallow's ceilings for
those can never fire first. What fallow adds is cognitive complexity, which
ESLint has no rule for, and CRAP — complexity weighted by how much of it the
tests actually reach.

Three things will bite otherwise:

- **`extends` replaces arrays, it does not merge them.** Setting your own
  `ignoreDependencies` drops the base config's, which is why the example repeats
  `@hogasi/fallow-config`. It has to be ignored because fallow resolves
  `extends` itself, so no import of it exists for the analyser to find.
- **fallow only knows the entry points it can see.** A test runner it has no
  plugin for makes every test file look unreachable. Declare them under `entry`
  rather than switching the rule off.
- **Suppressions need `--` before the reason.** Write
  `// fallow-ignore-next-line security-sink -- why`; without the delimiter every
  word of the prose is read as a rule name. `require-suppression-reason` and
  `stale-suppressions` are both errors here, so a suppression must say why and
  must be deleted once the finding is gone.

CRAP is estimated from export references unless you feed it real data, and the
estimate scores unexported helpers as untested. Pass
`fallow health --coverage coverage/coverage-final.json` for exact numbers. It
needs Istanbul format, which vitest's v8 provider does write, and
`@hogasi/vitest-config` turns on the `json` reporter for exactly this.

The VS Code extension and the CLI read the same config, and the extension
prefers `node_modules/.bin/fallow`, so the editor and CI agree on both the rules
and the version.

Renovate, in `renovate.json`:

```json
{ "extends": ["github>hogasi/.tooling//renovate/default"] }
```

The preset automerges patches, tooling minors, actions and Docker bumps, holds
every major for review, and lets security PRs through immediately. Two
prerequisites, or automerge silently does nothing useful: the repo needs **Allow
auto-merge** turned on, and it needs required status checks, since merging
automatically before any check is required merges without a gate.

## Versioning

Consumers pin `@v1`. Every release force-moves that tag. A breaking process
change becomes `v2`, and repos opt in one at a time.

Packages share a single version (changesets `fixed`). Add a changeset with
`pnpm changeset`; merging the release PR publishes and retags.

## Publishing

CI calls `release.yml` only for pushes to `main`, after Build & tests, Workflow
lint, Secret scan and Renovate config succeed for that commit. Dependency audit
stays advisory. Release has no independent push trigger, so publication is gated
even before repositories configure required merge checks.

The first publish of a package is manual, because npm trusted publishing can
only be configured on a package that already exists:

```sh
pnpm --filter @hogasi/tsconfig publish --access public
```

Then add a trusted publisher on npmjs.com pointing at `release.yml` in this
repo. Every later release publishes over OIDC, with no npm token stored
anywhere.

## Org settings

These are set by hand in the GitHub UI, once, and are not tracked as files here.
Config-as-code that nobody remembers to apply reads as applied when it is not,
which is worse than a checklist. See `PLAN.md` for the current values and the
reasoning behind each one.

## Working on this repo

`pnpm install` installs a `pre-commit` hook via `simple-git-hooks`. It scans the
staged diff with `gitleaks`, applies Prettier, and then runs `pnpm check` — the
same gate CI runs, so a red build shows up before the push rather than after it.

Two things it deliberately does not do: it never runs `eslint --fix`, because a
lint fix can rewrite logic and that belongs under review rather than inside a
commit hook, and it re-stages only paths that were already staged, so changes
left out of the commit on purpose stay out of it.

`gitleaks` is optional — the hook warns and skips the scan if it is missing
(`brew install gitleaks`), since CI scans the full history regardless. Node must
match `.nvmrc`; the hook sources `nvm` itself so GUI Git clients work. To bypass
it for one commit:

```sh
SKIP_SIMPLE_GIT_HOOKS=1 git commit
```
