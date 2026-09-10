# Decisions

Why things are the way they are. Read this before changing any of them — each
row is a question that has already been settled once.

| Thing                   | Decision                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tooling repo visibility | **public**                                                                  | Public reusable workflows, actions, and Renovate presets simplify cross-repo access. GitHub Packages still requires registry authentication even for public packages; visibility does not remove that requirement.                                                                                                                                                                                                                                                                                                                         |
| Product repo visibility | **private, under the org**                                                  | Branch protection / rulesets on private repos require a paid plan (Pro or Team). Without it there are no required status checks, so nothing gates merge.                                                                                                                                                                                                                                                                                                                                                                                   |
| Account                 | **org `hogasi`, on Team ($4/user/mo); personal account downgraded to Free** | Same price as personal Pro for one user, and buys the two things this plan is actually about: org-level secrets for private repos (one `CLAUDE_CODE_OAUTH_TOKEN`, rotated once) and org rulesets (branch protection defined once by repo pattern). Doing it at zero repos is free; doing it at four means rewriting every `uses:` path and the npm scope. Total spend stays $4/mo — the org replaces personal Pro rather than adding to it. Caveat: Team bills per seat, so if collaborators are likely, personal Pro is cheaper per head. |
| Package registry        | **GitHub Packages**, scope `@hogasi`                                        | These packages are only ever consumed by repos in this org. GitHub Packages authenticates with the workflow's own `GITHUB_TOKEN`, so no registry account and no stored credential exist to leak. The cost is that consumers need an `.npmrc` and a `read:packages` token even though the packages are public. The `hogasi` scope is held on npmjs, empty, so nobody else can claim it.                                                                                                                                                     |
| Renaming later          | GitHub org: yes, with redirects. npm scope: **no**                          | Org rename redirects web and git traffic, but Actions and reusable workflows do not follow redirects. Update every consumer reference as part of a rename; do not rely on reclaiming the old name. Pages URLs do not redirect. npm has no scope rename: changing means republishing every package and editing every consumer. That cost scales with consumer count, not time — trivial at one product repo, painful at four.                                                                                                               |
| Package versioning      | **fixed** (all packages share one version, bumped with `pnpm bump`)         | Independent versioning means reasoning about a compatibility matrix across four repos for zero benefit. One version number, one changelog.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Workflow versioning     | moving `v1` tag, force-updated on release                                   | Same model as `actions/checkout`. Consumers pin `@v1`; a breaking process change becomes `v2` and repos opt in one at a time.                                                                                                                                                                                                                                                                                                                                                                                                              |

## Constraints that change the layout

These are real GitHub limits, not preferences:

- **Reusable workflows must live at `.github/workflows/` — no subdirectories.**
  A `workflows/ci-sveltekit.yml` layout does not work.
- **Composite actions can live anywhere**, referenced as
  `owner/repo/path/to/action@ref`. Use these for the shared setup block only
  when shared setup earns it; check out before invoking a local action.
- **`uses:` cannot be an expression.** No dynamic workflow version. Renovate
  does update pinned `uses:` refs, so version bumps arrive as PRs.
- **Nesting cap: 10 workflow levels, 50 unique reusable workflows per top-level
  workflow.** A `ci-base.yml` that everything else extends burns a level; only
  add it once two flavours genuinely share steps.

Limits and rename behavior checked on 2026-09-09 against
[GitHub's reusable workflow reference](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).

## AI development decisions

- **The issue owns discovery and planning.** Comments hold the conversation; the
  body holds the proposal. Approval binds to a specific proposal revision.
- **Fable plans; Opus implements and writes tests.** `grilling` supplies the
  discovery method directly, adapted for issue conversations. The `grill-me`
  slash-command wrapper is not needed by the automated planner. Workflow jobs
  own model and effort defaults; prompt files own behavior.
- **CI executes tests independently.** No separate AI tester or required
  `ai/test` job. Required checks and owner merge remain the gates.
- **Codex reviews, targeting GPT-6 Astra.** Hosted exact-model selection is
  unresolved. Subscription authentication is preferred, but Fable plan access
  and any API-backed Astra alternative must be explicitly verified and agreed.
- **One GitHub App identity, no hosted service.** Authorized owner requests
  start Claude; initial repairs are explicit PR comments, not bot-to-bot loops.
- **Prove the whole loop before expanding.** A sandbox with ordinary CI is
  sufficient; reusable CI and the template follow real product consumers.

The canonical planned setting locations and unresolved provider constraints are
in [stage 2](stage-2-ai-layer.md#where-files-and-settings-belong). Enrollment
and credentials are tracked in [setup.md](setup.md).
