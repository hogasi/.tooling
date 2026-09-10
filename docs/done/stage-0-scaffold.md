# Stage 0 — scaffold (done)

Completed. The workspace, five packages, the Renovate preset and `self-ci.yml`
are built, published and green. Kept as the record of why each piece is shaped
the way it is; nothing here is an outstanding task.

## Stage 0 scaffold — built

Workspace, `@hogasi/tsconfig`, `@hogasi/prettier-config`,
`@hogasi/eslint-config`, `@hogasi/vitest-config`, `@hogasi/fallow-config`,
`renovate/default.json` and `self-ci.yml` are in the tree. `actions/setup`,
`ci-node.yml` and `renovate-failed.yml` were built and then removed — see
"Reusable CI removed until there is a second repo" below. `pnpm lint` and
`pnpm check` pass locally.

The two lint packages, the Renovate preset and the shape of the tsconfig base
were all pulled forward from Stage 1. The plan wanted them derived from two
repos rather than guessed; `silviuhogasi/sil` on `main` supplies that evidence
on its own, because its three apps already forced the author to split shared
rules from per-app overrides. This repo now formats itself with
`@hogasi/prettier-config`, so the local `.prettierrc.json` is gone.

Three deviations from the sketch above, each deliberate:

- **The composite action does not run `checkout`.** Callers check out first. A
  composite that checks out cannot be referenced as `./actions/setup`, which
  would force this repo's own workflows to call themselves through a published
  tag — so a PR editing the action would test the old version rather than its
  own.
- **`node-version` has no default; `.nvmrc` decides.** The composite action
  reads the checked-out repo's `.nvmrc` and fails loudly if there is neither an
  input nor a file. A hardcoded default in the shared action would silently
  drift from the version each repo actually develops against.
- **GitHub Packages, not npmjs.** These packages exist only for repos in this
  org, and GitHub Packages ties them to the org's own permissions: the
  workflow's `GITHUB_TOKEN` is the credential, so there is no registry account,
  no stored secret and no trusted publisher. The price is paid by consumers
  instead — GitHub Packages demands authentication to install even public
  packages, so every repo needs an `.npmrc` and every developer a
  `read:packages` token. Provenance attestation is npmjs-only and is lost. npmjs
  came first and reached 0.2.0 there over OIDC before being unpublished. That
  attempt failed twice for reasons both since removed: `release.yml` was a
  reusable workflow, so npm saw a different workflow file in the OIDC claim than
  the one configured, and `changeset publish` captured pnpm's output, so its
  `Skipped OIDC` warning never reached the log and the only visible symptom was
  an anonymous `E404`.
- **No changesets.** Versions are bumped by hand with `pnpm bump`, and
  `pnpm -r publish` skips whatever is already on the registry. Changesets bought
  generated changelogs and a release PR, and charged a bot PR, a merge that
  needed a PAT because `GITHUB_TOKEN` merges start no workflow run, and two CI
  runs per release. Not worth it for five config packages released rarely.

## Review gaps addressed

The Vitest package enables coverage without a CLI flag, ships a TypeScript
declaration, and declares jsdom as an optional peer required by its default
environment. Its consumer tests run the packed package, including plain
`vitest run`, DOM access, reporting with no threshold, and strict TypeScript
compilation.

`self-ci.yml` runs its release job after all four blocking checks succeed for
the same main-push commit. The dependency audit remains advisory. Release has no
independent push trigger, and main CI runs are not cancelled by later pushes.
Org-wide required merge checks remain a rollout task; publishing is already
gated without them.

Done: org `hogasi` exists and is on Team. Personal Pro downgraded. Org config is
applied by hand in the GitHub UI, per the checklist below — it is not kept as
files here, because config-as-code nobody remembers to run reads as applied when
it is not. gh token has `admin:org`. `hogasi/.tooling` exists (public, empty, no
commits pushed) — renamed from `platform-tooling`. Local checkout lives at
`~/hogasi/tooling`. The old personal `.tooling` repo was deleted, which is what
freed the name.

## CI hardening pulled forward from sil

`self-ci.yml` now runs five jobs rather than one: `check`, `actionlint`,
`gitleaks`, `renovate-config` and an advisory `audit`. Every workflow pins
`ubuntu-24.04`, sets `timeout-minutes` and sets `TZ: UTC`.

- **gitleaks runs as a pinned binary, not `gitleaks/gitleaks-action`.** That
  action needs a paid licence key for organisation-owned repositories, and
  obtaining one means handing an email address to a third party. The scanner
  itself is MIT. The workflow downloads a version-pinned release and verifies
  its SHA-256 before running it, so the version and the bytes are both pinned.
  It scans with `gitleaks git`, not `dir`: only the history mode catches a
  secret that was committed and later deleted, which was confirmed against a
  throwaway repo.
- **Bumping gitleaks is a two-line manual edit.** The version and its checksum
  both live in the workflow's `env`. Renovate cannot update the checksum, so
  letting it bump the version alone would break the job. Deliberately left
  manual — the failure would be loud, not silent, but there is no reason to
  invite it.
- **`renovate-config-validator` runs with `--no-global`.** Without that flag it
  validates the files against the self-hosted global schema instead of the repo
  and preset schema, so it would pass on configuration that Renovate itself
  rejects. Verified to exit 1 on a preset with an unknown option.
- **`audit` is `continue-on-error` and never a required check.** A new advisory
  against a transitive dependency must not block an unrelated pull request.
- **`actionlint` is the one added third-party action.** The org has no
  per-action allow-list (that needs Enterprise Cloud, see
  [setup.md](../setup.md)); SHA pinning is what guards it.
- **Action pins moved to `actions/checkout@v7`, `actions/setup-node@v7` and
  `pnpm/action-setup@v6.1.0`.** The last one matters most: pnpm 11 support
  landed in `action-setup` v6, and this workspace is on pnpm 11.

## This repo lints itself

`eslint.config.js` runs `@hogasi/eslint-config` against this tree, and `fallow`
checks for unreachable files, unused dependencies, duplication, complexity and
security sinks. Both are wired into `pnpm check`. Dead-code analysis was what
surfaced that `eslint` and `@hogasi/eslint-config` were installed here and never
used. Self-linting then surfaced two real defects in the shipped config:

- its test override matched only `.ts` and `.js`, so `.mjs` test files silently
  got none of the relaxations;
- `hogasiConfig` was a single 198-line function, over the 50-line limit the
  config itself enforces. It is now split across `presets.js`, `houseRules.js`
  and `overrides.js`.

This repo turns off exactly one shared rule, `vitest/no-import-node-test`,
because it publishes the vitest config and so tests itself with Node's built-in
runner rather than depending on what it ships.

## fallow replaced knip

The dead-code gate is `fallow dead-code`, configured in `.fallowrc.jsonc`. knip
was here first and did the same job; running both was the problem. The editor
extension only speaks fallow, so with two tools and two config files CI would
have enforced a different definition of dead code than the one shown inline
while editing. One tool, one config, same answer in both places.

fallow is MIT and on npm, so it installs as a plain devDependency and needs no
licence key for `dead-code`, `dupes` or `audit` — only runtime coverage is paid.
It resolves `node_modules/.bin/fallow` ahead of the copy the extension
downloads, so pinning the version here pins it for the editor too.

Two things about it are worth knowing before trusting a red result:

- **Severity decides whether CI gates.** A `warn` finding exits 0 and therefore
  gates nothing. `unused-dev-dependencies` and `unused-optional-dependencies`
  both default to `warn`; this repo publishes configuration, so a stray
  devDependency here is the same defect as a stray runtime dependency elsewhere.
  Both are raised to `error` in `.fallowrc.jsonc`.
- **Its zero-config run reported seven findings, all false.** Five test files
  looked unreachable because fallow has no plugin for `node --test` and nothing
  imports them; they are declared as `entry` instead. Two Prettier plugins
  looked unused because the shared config reaches them through
  `import.meta.resolve`, which no static analyser can follow; they are listed in
  `ignoreDependencies`. Every suppression in that file carries the reason.

## The fallow gates, and `@hogasi/fallow-config`

`pnpm check` runs `fallow` (dead code, duplication and health in one pass) and
then `fallow security --fail-on-issues`. Security is a separate command by
fallow's design: its findings are candidates for a human to verify and never
surface under the other commands, which also means it gates nowhere unless it is
run explicitly. Both exit non-zero on a finding, so neither is advisory.

The shared half of that configuration is published as `@hogasi/fallow-config`
and pulled in with `"extends": ["npm:@hogasi/fallow-config"]`. It carries what
is true for every repo — which rules gate, the cognitive-complexity ceiling, the
security catalogue — and leaves entry points and per-file exemptions to the
repo.

**Complexity is split between the two linters on purpose.** ESLint already caps
cyclomatic complexity at 8, function length at 30 code lines and nesting at 3,
so fallow's own ceilings for those can never fire first and are left at their
defaults. What fallow adds is cognitive complexity, which ESLint has no rule
for, and CRAP, which weights complexity by how much of it the tests reach.

**Enabling two security categories meant naming all 46.** `hardcoded-secret` and
`secret-to-network` only run when listed in `security.categories.include`, and
that key is a whitelist that drops everything omitted rather than an addition —
verified by watching the existing path-traversal finding disappear when the list
held one entry. So the package enumerates the full catalogue, and
`fallow-config.test.mjs` compares it against `fallow schema` on every run: an
upgrade that adds a category fails the test instead of silently narrowing the
scan. `hardcoded-secret` overlaps gitleaks, but `secret-to-network` is dataflow
that no secret scanner can see.

**CRAP is estimated unless it is measured**, and the estimate scores unexported
helpers as 0% covered. That is why `thresholdsFor` reported 42 against a ceiling
of 30 while six unit tests cover every branch of it. `@hogasi/vitest-config` now
emits the `json` coverage reporter so `fallow health --coverage` has real
numbers in product repos — vitest's v8 provider does write Istanbul format,
confirmed by running fallow against a fixture. This repo tests with
`node --test`, which emits no Istanbul data, so it carries a
`thresholdOverrides` entry with a written reason instead. That keeps the
function visible under a stated ceiling rather than hidden behind a suppression.

Three sharp edges, each found the hard way:

- **`extends` replaces arrays rather than merging them.** The base config has to
  ignore its own package name, because fallow resolves `extends` itself and no
  import of it exists for the analyser to find — and every repo that sets its
  own `ignoreDependencies` has to repeat that entry.
- **A suppression reason needs `--` in front of it.** Without the delimiter
  every word of the prose is parsed as a rule name; one sentence produced 20
  stale-suppression findings.
- **`require-suppression-reason` and `stale-suppressions` are both errors.**
  Suppressing a finding is allowed. Suppressing it silently, or leaving the
  comment behind after the code was fixed, is not.

## Comments are policed, not banned

`no-inline-comments` and `no-warning-comments` are errors. A comment sitting
beside a line of code nearly always restates it, and a `TODO` is deferred work
hidden where nobody is assigned to it. `silviu:` markers are untouched: those
record a deliberate ceiling and the trigger to raise it, which is a decision
rather than a reminder.

A blanket ban was considered and rejected. It contradicts a gate this repo
already runs — `require-suppression-reason` is an error, and a fallow
suppression _is_ a comment carrying prose — and there were no inline comments
here to begin with. All 58 comments in the tree explain _why_: why gitleaks
scans history, why `extends` arrays replace instead of merging, why the vitest
threshold shape is what it is. Those are the ones that stop the next reader from
simplifying a decision back into a bug.

**`sonarjs/no-commented-code` was tried and dropped.** It is the rule that
catches the actual defect, and `eslint-plugin-sonarjs@4.2.0` supports ESLint 10.
It also reports nothing when `parserOptions.projectService` is set — bisected on
one file, holding parser and rule constant, findings went 1 to 0 with that
option alone. Every layer of this config is type-aware, so the rule would have
been permanently inert. ESLint reports no error for a rule that never fires,
which is precisely why it was worth checking rather than assuming.

## Every rule now has to prove it fires

`houseRules.test.mjs` gives each of the 22 enabled house rules a file that
breaks it and asserts the rule is reported, and a final test fails if a rule is
added without a fixture. `fallow-config.test.mjs` does the same for the two
fallow gates by running them against a deliberately broken fixture project.

This exists because `sonarjs/no-commented-code` was configured at `error`,
resolved at `error` in `eslint --print-config`, and reported nothing. Severity
assertions cannot see that. Only a fixture can.

The harness immediately caught itself. The first draft named every fixture
`*.config.js` to keep it out of the type-aware project service, and `max-lines`
then looked inert — because the shared config switches `max-lines` off for
config files. The fixtures now live inside a real tsconfig project so they take
the same path a source file does.

## Reusable CI removed until there is a second repo

`ci-node.yml`, `renovate-failed.yml` and `actions/setup` are gone. All three
existed to serve product repos, and there are no product repos yet: nothing
called them, so nothing tested them, and a reusable workflow that has never been
consumed is a guess about its own interface. Their design and the reasoning
behind it stay in this document, which is the point of writing it down.

`self-ci.yml` remains. The three jobs that used `./actions/setup` now run its
four steps inline, and the composite's hand-rolled `.nvmrc` parsing collapses
into `actions/setup-node`'s own `node-version-file`. That is a straight
simplification, and it is worth noting that the composite was never needed to
read `.nvmrc` in the first place.

## Found by a full verification sweep

- **No `LICENSE` existed**, while all four packages declared `"license": "MIT"`.
  Added at the root and copied into each package, since npm only picks up a
  licence file sitting in the package directory itself. **The copyright holder
  is written as "Hogasi" — change it if that is not the name you want on it.**
- **`renovate-failed.yml`'s caller example was wrong.** A called workflow's
  token can only be the same or more restrictive than the caller's, so its
  job-level `pull-requests: write` cannot elevate anything. With the org default
  set to read-only, the labelling step would have returned 403. The example now
  grants the permission in the calling job, where it has to be.
- **Prettier does not read `.gitignore`.** The vitest integration fixture is
  created inside its package, so a crashed run would have left a directory that
  `prettier --check` then failed on. Added to `.prettierignore` as well.

## Adopted from sil

- **A pre-commit hook.** `.husky/pre-commit` is one line, `pnpm precommit`, and
  `precommit` is a command chain in `package.json`: `gitleaks git --staged`,
  `lint-staged`, then `pnpm check`. No shell script, and a product repo adopts
  it by copying a few lines. Catches a red build before the push rather than
  after it.

  Two deliberate differences from sil's script. It calls `gitleaks git --staged`
  instead of the deprecated `protect` subcommand. And formatting runs through
  `lint-staged` rather than `pnpm format` followed by `git add -u`: the latter
  stages every modified tracked file, so a change deliberately left unstaged
  ends up in the commit. `lint-staged` re-stages only the files it formatted.
  `eslint --fix` is still not run — Prettier only moves whitespace, a lint fix
  can rewrite logic. `HUSKY=0 git commit` bypasses the hook.

  **No nvm bootstrap or Node version check in the hook**, unlike sil. Both were
  copied in and then removed: `.nvmrc` and `engines` already declare the
  version, CI enforces it, and the bootstrap only earns its keep for GUI Git
  clients that do not read a shell profile. Add it back if one is ever used.

  **sil installs its hook with `simple-git-hooks`; this repo uses husky.** Both
  are zero-dependency and the choice is close to arbitrary — husky just drops a
  layer, since the hook file is the script rather than a package.json entry
  pointing at one. Worth converging sil onto husky so the org runs one
  installer, but nothing breaks while they differ.

## Package build order

Ship in this order and stop when the next one stops earning its keep.

1. **`@hogasi/tsconfig`** — built, as `base.json` and `svelte.json`. The `node`
   and `sveltekit` entries in this sketch were dropped: `sil` has no SvelteKit
   app and no NodeNext consumer, so both were guesses. The base is `sil`'s own
   `packages/config/tsconfig.base.json` plus three options measured to cost
   nothing on its real code, and minus `allowSyntheticDefaultImports`, which
   `esModuleInterop` already implies. `noEmit` deliberately stays out of the
   base so each consumer decides whether it emits, matching what `sil` does
   today.

   Measured against `sil` on `main`, counting new compiler errors each option
   introduces:

   | Option                       | apps/teebase | services/teebase |
   | ---------------------------- | ------------ | ---------------- |
   | `verbatimModuleSyntax`       | 0            | 0                |
   | `noImplicitOverride`         | 0            | 0                |
   | `noFallthroughCasesInSwitch` | 0            | 0                |
   | `noUncheckedIndexedAccess`   | +15          | +15              |

   The first three are in. `noUncheckedIndexedAccess` is out for now: it is the
   one that costs real work, and it should be adopted deliberately rather than
   smuggled in with a config bump.

2. **`@hogasi/prettier-config`** — built. A single exported object, lifted
   verbatim from `sil`. One non-obvious detail: plugin names are resolved to
   absolute URLs via `import.meta.resolve` rather than left as bare specifiers,
   because Prettier resolves a bare plugin name from the _consumer's_ directory,
   where the plugins are not installed. The test caught this on the first run.
3. **`@hogasi/eslint-config`** — built, but as a single default export that is a
   _function_, not the three entry points sketched here. Four settings (the
   ignore file, the TypeScript project root, the resolver's project globs, and
   the files allowed outside the project service) can only resolve against the
   consuming repo, so a plain array cannot express them. Three entry points were
   dropped as speculative: the one real consumer is a Svelte repo. The plugins
   ship as ordinary dependencies rather than peers, so a consumer deletes a
   dozen catalog pins instead of hand-installing them. `eslint` and `typescript`
   stay peers. This is still the package that will cost the most to maintain.
4. **`@hogasi/vitest-config`** — built. The plan said defer, on the grounds that
   it would be a wrapper around four lines. Reading both `sil` vitest configs
   changed that: the two apps agree on environment, test glob, coverage
   provider, reporter and what to leave out of the denominator, and disagree
   only on plugins, aliases, setup files and the coverage target. So the package
   exports the **`test` block only**, never a whole config. Plugins and aliases
   resolve against the consumer's own Vite, and a shared package owning them
   would either pin the wrong copy of `@sveltejs/vite-plugin-svelte` or force
   every non-Svelte repo to install it.

   `coverageInclude` is required rather than defaulted. With no include list, v8
   counts whatever happened to be imported, so the number stops meaning anything
   — exactly the failure this package exists to prevent.

   The non-obvious part is the threshold shape. Vitest only accepts
   `{ 100: true }` as the "every metric at 100" shorthand; any other target has
   to name `branches`, `functions`, `lines` and `statements` individually, and a
   wrong shape is silently ignored rather than rejected. The tests therefore run
   the real vitest binary against a half-covered fixture and assert the exit
   code, in both shapes. That fixture is created inside the package, not in the
   system temp directory, because a config file outside the workspace cannot
   resolve `vitest/config`.

5. **`@hogasi/fallow-config`** — built, and not planned for. It exists because
   the fallow config stopped being "a handful of lines" the moment the security
   catalogue had to be enumerated. A 46-entry whitelist plus eight severity
   raises is not something to copy into every repo by hand, and the drift test
   that keeps the whitelist honest only has to be written once.

   It ships one file, `base.jsonc`, referenced through `main`. fallow's
   `extends` accepts `npm:<package>`, so nothing has to resolve it at build
   time. The package deliberately does not set entry points or ignores: those
   are the parts that differ per repo, and arrays replace rather than merge, so
   a base config that guessed at them would be overwritten anyway.

`@hogasi/svelte-config` from the original sketch: skip. `svelte.config.js` is
mostly adapter choice and aliases, which are per-product by nature.

## Layout

```
.tooling/                             (public)
├── .github/workflows/
│   └── self-ci.yml                  this repo's own CI
├── packages/
│   ├── tsconfig/
│   ├── prettier-config/
│   ├── eslint-config/
│   ├── vitest-config/
│   └── fallow-config/
├── renovate/
│   └── default.json
├── pnpm-workspace.yaml
└── package.json
```

## Renovate preset

`renovate/default.json` is a straight port of `sil`'s `renovate.json5`. It is
written as JSON rather than JSON5 so the reasoning survives as `description`
fields, which Renovate surfaces in the dashboard and PR bodies instead of hiding
it in comments. A public preset needs no auth even from private consumers.
Validated in CI with `renovate-config-validator --no-global`.

## Moved to stage 1

The contract between tooling and products
(`pnpm check · pnpm build · pnpm test:e2e`), the reusable CI workflow's input
cap, and the success check that needs product repo #1 now live in
[stage-1-template-repo.md](../stage-1-template-repo.md). They were written here
first, but they describe work that cannot be verified until a product repo
consumes it, so they are outstanding rather than done.
