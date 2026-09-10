# Stage 1 — reusable CI and the template repo

Reusable CI and the template are not started. Tooling protection can be
completed now. The lint packages, Renovate preset and tsconfig base that this
stage originally covered were pulled forward into stage 0. What remains splits
in two by what it needs to exist first:

- **Reusable CI** needs product repo #1. It is the first thing that consumes the
  packages through a real workflow, and the check name it reports is what
  unblocks required status checks and Renovate automerge.
- **The template repo** needs product repo #2. A template derived from one repo
  is that repo with the name filed off; two repos show which files actually
  diverge.

## Reusable CI — `ci-node.yml`

Built once in stage 0 and removed, because a reusable workflow nobody calls is a
guess about its own interface. Rebuild it when product repo #1 exists, from the
design below, and let that repo be the test.

The workflow calls **pnpm script names**, never tools:

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

Inputs, with a hard cap of five:

```yaml
node-version: string   default '' — falls back to the repo's .nvmrc
run-e2e: boolean  default false
build: boolean  default true
```

If it needs a sixth input, split it into `ci-sveltekit.yml` / `ci-capacitor.yml`
instead. A workflow with twelve boolean inputs is worse than three workflows.

Keep setup and check naming explicit:

- Check out the consumer before invoking any local composite action. Prefer
  `actions/setup-node` with `node-version-file` over a custom parser; add a
  composite only when shared setup earns it.
- Observe the actual caller/called job display names on a PR before requiring
  them; do not guess a check name from the workflow filename.

## Tooling protection — before product repo #1

`.tooling` already has Build & tests, Workflow lint, Secret scan, and Renovate
config jobs. Observe their reported names and require them for `.tooling` now.
Keep the dependency audit advisory. Align existing action references with the
SHA policy before enabling it, as described in [setup.md](setup.md).

## What repo #1 unblocks, in order

1. Observe the check name on the first real PR and add it as a required status
   check in a repository rule or an org ruleset scoped to CI consumers. Do not
   add a product-only check to the rule targeting all repositories.
2. Enable **Allow auto-merge** on the repo
   (`gh api -X PATCH repos/OWNER/REPO -f allow_auto_merge=true`). It is per-repo
   with no org default. Until both this and the required check exist, the
   Renovate automerge tiers merge before CI has said anything, so they are the
   dangerous half of the preset rather than the useful half.
3. Tighten the org-admin bypass from `always` to `pull_request` once a red
   `main` can be fixed through a PR.

## Success check

Product repo #1 consumes the shared configs and reusable CI with only local
wiring. Required checks reject a deliberately failing PR, including an
App-authored PR from stage 2. A config release produces a Renovate update under
the preset's schedule and release-age policy; no within-a-day promise bypasses
that policy. Acceptance criteria needing browser behavior have E2E coverage.

## Template repo

Separate repo (`svelte-platform-template`), marked as a GitHub template. It
holds only the thin wiring: `package.json` with the three script names,
`eslint.config.js` re-exporting the shared config, `tsconfig.json` extending the
shared one, `.github/workflows/ci.yml` calling `ci-node.yml@v1`,
`renovate.json`, `AGENTS.md` skeleton with review guidance, and the proven stage
2 AI caller. Include an enrollment checklist for secret access, model
availability, Codex review settings, labels, and scoped required checks. A
template cannot apply those account settings itself.

Templates solve creation, not sync. Everything that must evolve lives in
packages or reusable workflows; the template only contains files that are
_supposed_ to diverge.
