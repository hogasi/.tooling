# .tooling

Shared config packages for the `hogasi` org. This file is how to use them;
[docs/](docs/) holds the plan, the decisions and their reasoning.

## Setup

Packages ship to **GitHub Packages**, which requires auth even for public
packages. Commit this `.npmrc` in each consuming repo:

```
@hogasi:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

It holds no secret, only the variable name. Then set `NODE_AUTH_TOKEN`:

- **Locally** — a GitHub token with `read:packages`. One covers the whole org.
- **In CI** — `${{ secrets.GITHUB_TOKEN }}`, plus `packages: read` on the job.

> An install that 404s on `@hogasi/*` is this, not a missing version.

## The contract

Every repo exposes the same three scripts, and the tooling only calls these:

```
pnpm check · pnpm build · pnpm test:e2e
```

`check` is one aggregate of every gate: format, lint, typecheck, dead code,
complexity, security, tests. One script means a repo can add a gate without
changing anything shared. A `.nvmrc` holds the Node version.

## Packages

### `@hogasi/tsconfig`

```json
{ "extends": "@hogasi/tsconfig/base" }
```

`/svelte` adds the DOM libraries. The base sets no `lib`, `types` or `noEmit`,
so you still declare what you target and whether you emit.

### `@hogasi/prettier-config`

```json
{ "prettier": "@hogasi/prettier-config" }
```

Replaces any local `.prettierrc`. Keep your own `.prettierignore` — Prettier
does not read one from a shared config.

### `@hogasi/eslint-config`

A function, not an array. Four settings can only resolve against your repo:

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
  // Repo overrides go here, after the shared blocks.
);
```

`rootDir` is required and throws when missing — it supplies both the TypeScript
project root and the `.gitignore` used as the ignore list.

Two rules surprise people: `no-inline-comments` and `no-warning-comments` are
errors. A comment beside code usually restates it, and a `TODO` is deferred work
with nobody assigned. `silviu:` markers, standalone why-comments, JSDoc and lint
suppressions all stay legal.

### `@hogasi/vitest-config`

```sh
pnpm add -D @hogasi/vitest-config vitest @vitest/coverage-v8 jsdom
```

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

- `coverageInclude` is **required** — without it v8 measures whatever happened
  to get imported and the percentage stops meaning anything.
- Coverage gates at **100%** by default. Pass `coverageThreshold: 95` for a
  lower bar, or `false` to report without gating.
- `jsdom` is only needed for the default environment. Node-only consumers omit
  it and pass `environment: "node"`.

### `@hogasi/fallow-config`

Dead code, complexity and security, in `.fallowrc.jsonc`:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",
  "extends": ["npm:@hogasi/fallow-config"],
  "entry": ["src/routes/**"],
  "ignoreDependencies": ["@hogasi/fallow-config"]
}
```

```json
"check": "pnpm lint && fallow && fallow security --fail-on-issues && vitest run"
```

`fallow` covers dead code, duplication and health in one pass and exits non-zero
on any finding. `security` is separate because its findings need a human — which
also means it gates nothing unless you run it.

**Three things will bite you:**

1. **`extends` replaces arrays, it does not merge them.** Setting your own
   `ignoreDependencies` drops the base config's — hence the repeat above. It
   must be ignored because fallow resolves `extends` itself, so no import of it
   exists for the analyser to find.
2. **fallow only knows the entry points it can see.** A test runner it has no
   plugin for makes every test file look unreachable. Declare them under
   `entry`; don't switch the rule off.
3. **Suppressions need `--` before the reason.** Write
   `// fallow-ignore-next-line security-sink -- why`. Without the delimiter,
   every word of your prose is read as a rule name.

Complexity is split on purpose: ESLint already caps cyclomatic complexity,
function length and nesting, so fallow's ceilings for those never fire first.
What fallow adds is cognitive complexity and CRAP. CRAP is estimated from export
references unless you feed it real data — pass
`fallow health --coverage coverage/coverage-final.json` for exact numbers.

### Renovate

```json
{ "extends": ["github>hogasi/.tooling//renovate/default"] }
```

Automerges patches, tooling minors, actions and Docker bumps; holds every major
for review; lets security PRs through immediately.

Two prerequisites or automerge silently does nothing useful: **Allow
auto-merge** turned on, and **required status checks** — merging before any
check is required merges without a gate.

## AI development

`.github/workflows/ai.yml` is a reusable workflow that runs the issue-to-merge
loop: Fable does discovery and planning in the issue, the owner approves a
proposal revision, and Opus implements it and opens a pull request. The role
instructions live in [agents/](agents/) and ship with the workflow — a caller
pinned to `@v1` gets the prompts from that same commit, not from `main`.

```yaml
jobs:
  ai:
    uses: hogasi/.tooling/.github/workflows/ai.yml@v1
```

It does nothing until the `AI_ROLES` variable names a role, and it needs a
GitHub App, three secrets and two labels first. The caller to copy and the
enrollment steps are in [docs/setup.md](docs/setup.md); the design and its open
questions are in [docs/stage-2-ai-layer.md](docs/stage-2-ai-layer.md).

> None of this has run against GitHub yet.

## Releasing

```sh
pnpm bump 0.3.0        # or minor / patch
git commit -am "chore: release 0.3.0"
git push
```

All five packages share one version. CI publishes anything not yet on the
registry and force-moves the `v1` tag consumers pin. A push that bumps nothing
publishes nothing.

The release job runs only on `main`, only after Build & tests, Workflow lint,
Secret scan and Renovate config pass. It has no independent trigger. No
credential is stored — GitHub Packages accepts the workflow's own
`GITHUB_TOKEN`.

A breaking change to the contract becomes `v2`, and repos opt in one at a time.

## Working on this repo

`pnpm install` wires up `.husky/pre-commit`, which is one line:
`pnpm precommit`. That scans the staged diff with `gitleaks`, formats staged
files with Prettier, then runs `pnpm check` — the same gate as CI. Run it by
hand any time.

- Needs `gitleaks` (`brew install gitleaks`). The hook fails loudly if it's
  missing rather than skipping the scan.
- Formatting goes through `lint-staged`, so it touches only files in the commit.
  `pnpm format && git add -u` would sweep in changes you left out on purpose.
- `eslint --fix` is deliberately not run. Prettier moves whitespace; a lint fix
  can rewrite logic, and that belongs under review.
- The hook is feedback, not a gate — `--no-verify` skips it and a fresh clone
  has none. CI is what enforces this.

```sh
HUSKY=0 git commit    # skip the hook
```

## Org settings

Set by hand in the GitHub UI, once; not tracked as files. Config-as-code nobody
remembers to apply reads as applied when it isn't. Values and reasoning are in
[docs/setup.md](docs/setup.md).
