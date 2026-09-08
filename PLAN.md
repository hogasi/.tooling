# .tooling — build plan

## Status (2026-09-08, verified)

### Review gaps addressed

The Vitest package enables coverage without a CLI flag, ships a TypeScript
declaration, and declares jsdom as an optional peer required by its default
environment. Its consumer tests run the packed package, including plain
`vitest run`, DOM access, reporting with no threshold, and strict TypeScript
compilation.

`self-ci.yml` calls `release.yml` after all four blocking checks succeed for the
same main-push commit. The dependency audit remains advisory. Release has no
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

### Manual — needs you (in this order)

1. **Apply the org rules by hand.** Nothing here applies them for you.

   **Settings → Actions → General**
   (https://github.com/organizations/hogasi/settings/actions):
   - _Policies_: **Allow enterprise, and select non-enterprise, actions and
     reusable workflows**, enabled for **all repositories**. Tick **Allow
     actions created by GitHub** and **Allow actions by Marketplace verified
     creators**, then list these patterns:
     ```
     anthropics/claude-code-action@*
     changesets/action@*
     hogasi/*
     pnpm/action-setup@*
     raven-actions/actionlint@*
     ```
   - _Workflow permissions_: **Read repository contents and packages
     permissions**, and tick **Allow GitHub Actions to create and approve pull
     requests**. The tick box is required — without it `changesets/action` gets
     a 403 and the release PR is never opened. See the note below on why this
     grants nothing extra today.

   **Settings → Repository → Rulesets → New ruleset** — name it
   `main: PR required, no force-push, no deletion`, enforcement **Active**,
   target **all repositories** and the **default branch**. Enable: restrict
   deletions, block force pushes, and require a pull request with **0
   approvals** plus **require conversation resolution before merging**. Add
   **Organization admin** as a bypass actor set to **Always**.

   **Repository-level check.** The Actions workflow permission also exists per
   repository and an existing repo keeps its own value, so setting the org
   default does not necessarily flip it. Confirm and fix `.tooling` directly:

   ```sh
   gh api repos/hogasi/.tooling/actions/permissions/workflow
   gh api -X PUT repos/hogasi/.tooling/actions/permissions/workflow \
     -F default_workflow_permissions=read \
     -F can_approve_pull_request_reviews=true
   ```

2. **Add the `RELEASE_PAT` repository secret.** Settings → Secrets and variables
   → Actions. A fine-grained token scoped to this repo with **contents: read and
   write** and **pull requests: read and write**. It merges the `chore: release`
   PR; a merge made with `GITHUB_TOKEN` starts no new workflow run, so the
   publish would never fire. Without it the release PR is opened and then sits
   there.

3. **Log in to npm and claim the scope.** The scope cannot be renamed later, so
   do this before any `package.json` is written. There is no CLI for creating an
   org; `npm org` only manages members. Create it in the browser at
   https://www.npmjs.com/org/create (free, public packages). The `hogasi`
   username is unclaimed on the registry.
   ```sh
   npm login
   ```
   Note: the `npm` shell alias in zsh is broken
   (`command not found: _block_mgr`); use the binary directly or fix the shell
   function first.
4. **UI-only settings** — no API for these:
   - Org → Settings → Authentication security → **Require two-factor
     authentication**. Your own account must have 2FA on first, or you get
     locked out of the org.
   - Org → Settings → Secrets and variables → Actions → **New organization
     secret** `ANTHROPIC_API_KEY`, access: selected repositories. Needed at
     Stage 2, not before.
   - Install the **Renovate** GitHub App on the org (github.com/apps/renovate),
     all repositories. Needed at Stage 1.
5. **Drop the `delete_repo` scope** now that the personal repo is deleted:
   `gh auth refresh -h github.com -r delete_repo`.

### Stage 0 scaffold — built

Workspace, changesets, `@hogasi/tsconfig`, `@hogasi/prettier-config`,
`@hogasi/eslint-config`, `@hogasi/vitest-config`, `@hogasi/fallow-config`,
`renovate/default.json`, `self-ci.yml` and `release.yml` are in the tree.
`actions/setup`, `ci-node.yml` and `renovate-failed.yml` were built and then
removed — see "Reusable CI removed until there is a second repo" below.
`pnpm lint` and `pnpm check` pass locally. Nothing is committed yet, and the
first `npm publish` still waits on the npm org above.

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
- **No `NPM_TOKEN`.** Releases publish over npm trusted publishing (OIDC), so no
  long-lived registry credential exists anywhere. The cost is that the very
  first publish of each package must be manual, because a trusted publisher can
  only be attached to a package that already exists on the registry. `README.md`
  has the command. Note that `changeset publish` shells out to `pnpm publish` in
  a pnpm workspace, so this rides on pnpm's OIDC support, not npm's — confirm it
  on the first automated release rather than assuming it.

One org setting had to be loosened to make this work:

- **`can_approve_pull_request_reviews` is now `true`** in the org Actions
  settings. That field is the API side of "Allow GitHub Actions to create and
  approve pull requests", and it gates _creation_ as well as approval. With it
  off, `changesets/action` gets a 403 the first time a changeset lands and the
  release pipeline silently never fires. It grants nothing extra today because
  required approvals is 0 — but if that count ever rises, an Actions-approved PR
  would satisfy it, so revisit this line at the same time.

### CI hardening pulled forward from sil

`self-ci.yml` now runs five jobs rather than one: `check`, `actionlint`,
`gitleaks`, `renovate-config` and an advisory `audit`. Every workflow pins
`ubuntu-24.04`, sets `timeout-minutes` and sets `TZ: UTC`.

- **gitleaks runs as a pinned binary, not `gitleaks/gitleaks-action`.** That
  action needs a paid licence key for organisation-owned repositories, and
  obtaining one means handing an email address to a third party. The scanner
  itself is MIT. The workflow downloads a version-pinned release and verifies
  its SHA-256 before running it, so nothing extra lands on the org allow-list.
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
- **`actionlint` is the one added third-party action**, so
  `raven-actions/actionlint@*` joins the org Actions allow-list.
- **Action pins moved to `actions/checkout@v7`, `actions/setup-node@v7` and
  `pnpm/action-setup@v6.1.0`.** The last one matters most: pnpm 11 support
  landed in `action-setup` v6, and this workspace is on pnpm 11.
- **`changesets/action` is pinned to `v2.1.2`.** The earlier `@v1` resolved to
  nothing at all — that repository publishes no moving major tags. Bumping to v2
  also means renaming every input: `version` became `version-script`, `publish`
  became `publish-script`, `title` became `pr-title`, `commit` became
  `commit-message`, and the `GITHUB_TOKEN` env var became a `github-token`
  input. Unknown inputs are ignored rather than rejected, so the first release
  would have opened a pull request titled "Version Packages" and published
  nothing, with no error anywhere. `actionlint` does not check third-party
  action inputs; the editor's GitHub Actions extension is what caught it.

### This repo lints itself

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

### fallow replaced knip

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

### The fallow gates, and `@hogasi/fallow-config`

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

### Comments are policed, not banned

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

### Reusable CI removed until there is a second repo

`ci-node.yml`, `renovate-failed.yml` and `actions/setup` are gone. All three
existed to serve product repos, and there are no product repos yet: nothing
called them, so nothing tested them, and a reusable workflow that has never been
consumed is a guess about its own interface. Their design and the reasoning
behind it stay in this document, which is the point of writing it down.

`self-ci.yml` and `release.yml` remain. The three jobs that used
`./actions/setup` now run its four steps inline, and the composite's hand-rolled
`.nvmrc` parsing collapses into `actions/setup-node`'s own `node-version-file`.
That is a straight simplification, and it is worth noting that the composite was
never needed to read `.nvmrc` in the first place.

### Every rule now has to prove it fires

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

### TypeScript 7 cannot be adopted yet

`pnpm update --latest` moved TypeScript to 7.0.2, which typescript-eslint
refuses to load against: its peer range is `>=4.8.4 <6.1.0` and the plugin
throws on import rather than degrading. TypeScript is pinned to `^6.0.3`, and
`@hogasi/eslint-config` declares the same bound as its own peer range rather
than a plain caret, so a consumer on TS 7 gets a resolution error instead of a
crash at lint time.

unicorn 74 split `prevent-abbreviations` in two. `name-replacements` is the half
that wants `rootDir` to become `rootDirectory`, so it is off for the same reason
its parent was. The other two new rules were right and the code changed instead:
`consistent-boolean-name`, and `require-array-sort-compare`, which was flagging
`.toSorted()` comparisons that are clearer as `Set` comparisons anyway.

### Found by a full verification sweep

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

### Adopted from sil

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

### Not adopted from sil

- **`boot-smoke`.** Product-specific; there is nothing here to boot.
- **`claude.yml` as written.** It fires on `@claude` in any comment with no
  `author_association` gate. Stage 2 must add that gate. A prompt-level
  instruction telling the model to ignore untrusted comments is not a security
  control.

### Deliberately not in the ruleset yet

- **Required status checks.** Adding a check name that no workflow reports yet
  blocks every merge in every repo. `ci-node.yml` now exists, but a reusable
  workflow reports as `<caller job id> / ci`, not `ci` — so the exact string
  depends on what product repo #1 names its job. Observe it on the first real
  PR, then add it to the `main` ruleset.
- **Required approvals is 0.** GitHub won't let a PR author approve their own
  PR, so any count above zero locks a solo maintainer out entirely. The AI
  review checks become the gate instead, via required status checks.
- **Org admin bypass is `always`.** Lets you push the initial scaffold and fix a
  broken `main` without a PR. Tighten to `pull_request` once the pipeline is
  stable.

## Decisions

| Thing                   | Decision                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tooling repo visibility | **public**                                                                  | Reusable workflows, composite actions, Renovate presets and npm scope all resolve with zero auth. Private costs an access toggle per repo, a Renovate token, and registry auth in every CI job — to protect eslint configs.                                                                                                                                                                                                                                                                                                          |
| Product repo visibility | **private, under the org**                                                  | Branch protection / rulesets on private repos require a paid plan (Pro or Team). Without it there are no required status checks, so nothing gates merge.                                                                                                                                                                                                                                                                                                                                                                             |
| Account                 | **org `hogasi`, on Team ($4/user/mo); personal account downgraded to Free** | Same price as personal Pro for one user, and buys the two things this plan is actually about: org-level secrets for private repos (one `ANTHROPIC_API_KEY`, rotated once) and org rulesets (branch protection defined once by repo pattern). Doing it at zero repos is free; doing it at four means rewriting every `uses:` path and the npm scope. Total spend stays $4/mo — the org replaces personal Pro rather than adding to it. Caveat: Team bills per seat, so if collaborators are likely, personal Pro is cheaper per head. |
| Package registry        | npm, public scope                                                           | Public scope is free. `pnpm` cannot install a subdirectory of a git repo reliably, so a registry is genuinely needed. Reserve the scope early.                                                                                                                                                                                                                                                                                                                                                                                       |
| Renaming later          | GitHub org: yes, with redirects. npm scope: **no**                          | Org rename redirects web and git traffic, but releases the old name for anyone to claim — immediately re-create it as a placeholder org, or a squatter inherits your `uses:` references. Pages URLs do not redirect. npm has no scope rename: changing means republishing every package and editing every consumer. That cost scales with consumer count, not time — trivial at one product repo, painful at four.                                                                                                                   |
| Package versioning      | **fixed** (all packages share a version) via changesets                     | Independent versioning means reasoning about a compatibility matrix across four repos for zero benefit. One version number, one changelog.                                                                                                                                                                                                                                                                                                                                                                                           |
| Workflow versioning     | moving `v1` tag, force-updated on release                                   | Same model as `actions/checkout`. Consumers pin `@v1`; a breaking process change becomes `v2` and repos opt in one at a time.                                                                                                                                                                                                                                                                                                                                                                                                        |

## Constraints that change the layout

These are real GitHub limits, not preferences:

- **Reusable workflows must live at `.github/workflows/` — no subdirectories.**
  A `workflows/ci-sveltekit.yml` layout does not work.
- **Composite actions can live anywhere**, referenced as
  `owner/repo/path/to/action@ref`. Use these for the shared setup block
  (checkout + pnpm + node + cache) that every workflow repeats.
- **`uses:` cannot be an expression.** No dynamic workflow version. Renovate
  does update pinned `uses:` refs, so version bumps arrive as PRs.
- **Nesting cap: 4 levels of reusable-workflow calls, 20 calls per workflow
  file.** A `ci-base.yml` that everything else extends burns a level; only add
  it once two flavours genuinely share steps.

## Layout

```
.tooling/                             (public)
├── .github/workflows/
│   ├── release.yml                  changesets publish + retag v1
│   └── self-ci.yml                  this repo's own CI
├── packages/
│   ├── tsconfig/
│   ├── prettier-config/
│   ├── eslint-config/
│   ├── vitest-config/
│   └── fallow-config/
├── renovate/
│   └── default.json
├── agents/                          (stage 2 — empty for now)
├── .changeset/
├── pnpm-workspace.yaml
└── package.json
```

Note `agents/` is _not_ under `.github/` — those are prompt files read by a
workflow, not workflows.

## The actual contract between tooling and products

The reusable workflow calls **pnpm script names**, never tools:

```
pnpm check · pnpm build · pnpm test:e2e
```

`check` is one aggregate covering every gate that must pass: format, lint,
typecheck, dead code, unit and integration tests. An earlier draft called
`lint`, `check`, `test` and `build` as four separate steps. That double-ran the
linter and the suite in any repo whose `check` was already an aggregate (sil's
is), and left no slot at all for a gate outside the four, such as dead-code
analysis or `svelte-check`. One aggregate lets a repo add a gate without a
change here.

This is the real decoupling. A repo that swaps Vitest for something else changes
one line of its own `package.json` and the shared CI keeps working. Resist
adding a `test-command:` input — that just moves the coupling into the caller.

`ci-node.yml` inputs, and a hard cap of five:

```yaml
node-version: string   default '' — falls back to the repo's .nvmrc
run-e2e: boolean  default false
build: boolean  default true
```

If it needs a sixth input, split it into `ci-sveltekit.yml` / `ci-capacitor.yml`
instead. A workflow with twelve boolean inputs is worse than three workflows.

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

`@hogasi/svelte-config` from the original sketch: skip. `svelte.config.js` is
mostly adapter choice and aliases, which are per-product by nature.

## Renovate

Preset at `renovate/default.json`, consumed as:

```json
{ "extends": ["github>hogasi/.tooling//renovate/default"] }
```

A public preset needs no auth even from private consumers.

Built, as a straight port of `sil`'s `renovate.json5`. It is written as JSON
rather than JSON5 so that the reasoning survives as `description` fields, which
Renovate also surfaces in the dashboard and PR bodies instead of hiding them in
comments. Validated with `renovate-config-validator`.

Two prerequisites that are not satisfied yet, and until they are, the automerge
tiers are the dangerous half of the config rather than the useful half:

- **Each repo needs `Allow auto-merge` enabled.** It is a per-repo setting with
  no org-level default, so it has to be set on every repo
  (`gh api -X PATCH repos/OWNER/REPO -f allow_auto_merge=true`).
- **Required status checks must exist first.** Automerging into a branch where
  no check is required means merging before CI has said anything. That is the
  same gap tracked above under the ruleset.

## Template repo

Separate repo (`svelte-platform-template`), marked as a GitHub template. It
holds only the thin wiring: `package.json` with the four script names,
`eslint.config.js` re-exporting the shared config, `tsconfig.json` extending the
shared one, `.github/workflows/ci.yml` calling `@v1`, `renovate.json`,
`AGENTS.md` skeleton.

Templates solve creation, not sync — correctly identified already. Everything
that must evolve lives in packages or reusable workflows; the template only
contains files that are _supposed_ to diverge.

## Stage 2 — the AI layer

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

### What I'd change from the plan you have

**Build the reviewer first, not the planner.** You have no human reviewer, so an
independent review pass is the single highest-value agent. The planner is
valuable to a team that needs shared understanding of a ticket; solo, you
already know what you meant. Ordering: reviewer → planner → tester → architect →
steward.

**Do not build a GitHub App.** An App means a webhook receiver, a hosted
process, a queue, and a database you keep alive and pay for — to orchestrate
work for a solo developer. `anthropics/claude-code-action@v1` runs inside your
existing Actions on your API key with zero infrastructure, and gets triggered by
`@claude` mentions or `pull_request` events. One reusable workflow in this repo,
called by every product repo. Revisit the App only when the Actions version
demonstrably cannot express something you need.

**Drop `.github/ai.yml`.** A config schema for a system that does not exist yet
is the exact speculative abstraction to avoid. Use reusable-workflow inputs;
promote to a config file if and only if the inputs exceed what inputs can
express.

**Four separate agent roles is fine as prompts; five installed apps is not.**
`agents/reviewer.md`, `agents/planner.md` etc. are files read by the workflow.
Distinct check names (`ai/review`, `ai/test`) come from distinct jobs, not
distinct apps.

### Two gotchas that will bite exactly here

- **Commits pushed with `GITHUB_TOKEN` do not trigger further workflows.**
  GitHub blocks this to prevent loops. So when the coding agent pushes a fix to
  a PR branch, CI and the re-review will _not_ re-run. You need a PAT or a
  GitHub App installation token for the agent's pushes. This breaks the
  review→fix→re-review loop silently, and it looks like the agent did nothing.
- **Comment-triggered agents need an author check.** Gate on
  `github.event.comment.author_association` being `OWNER` or `COLLABORATOR`
  before the job runs, not inside the prompt. A prompt-level instruction to
  ignore untrusted comments is not a security control.

### Cost

Three agents on every PR, each reading a diff and repo context, is real money at
Opus rates. Start with the reviewer on `pull_request` only, measure a month,
then decide whether the planner earns its cost.

## Sequencing

**Stage 0 — this week.** Org and plan done; the manual checklist at the top is
the remaining prerequisite. Then: public tooling repo, pnpm workspace,
changesets, `@hogasi/tsconfig` published, `release.yml` with the `v1` retag.
Then build product repo #1 consuming it. Nothing else.

Org-level config is applied by hand in the GitHub UI, using the manual checklist
at the top of this file as the record of what it should be.

**Stage 1 — after product repo #2 exists.** eslint-config and prettier-config,
extracted from what the two repos actually share rather than guessed. Renovate
preset. Template repo, derived from repo #2's real contents.

**Stage 2.** `ai-review.yml` + `agents/reviewer.md`. Enable on one repo. Run it
for a month.

**Stage 3.** Issue triage / planner, only if you find yourself writing
acceptance criteria by hand repeatedly.

**Do not build yet:** architect gate, adversarial tester, repo steward, `ai.yml`
config schema, GitHub App, `ci-base.yml`, vitest-config, deploy workflows. Each
of these is a response to a problem you have not had yet. The steward in
particular only makes sense once there is enough code to drift.

## Success check for stage 0

Product repo #1 contains: a `tsconfig.json` of two lines, a CI workflow of five
lines, and no copied config. Changing a compiler option in this repo and cutting
a release produces a Renovate PR on repo #1 within a day.
