# Manual setup

This is the checklist of intended GitHub settings, not proof that they are
applied. Apply and verify them during enrollment; record the verification date.
The AI files described in [stage 2](stage-2-ai-layer.md) exist now, but nothing
in step 4 has been applied or verified against GitHub.

1. **Apply the org rules by hand.** Nothing here applies them for you.

   **Settings → Actions → General**
   (https://github.com/organizations/hogasi/settings/actions):
   - _Policies_: allow the actions needed by enrolled repositories. First
     replace the tag references in `self-ci.yml` with reviewed full-length
     commit SHAs; then enable **Require actions to be pinned to a full-length
     commit SHA** and verify a PR runs. Current workflow tags do not satisfy
     that policy. GitHub documents selected-action allow-lists at organization
     level; verify available controls in the org rather than assuming Enterprise
     is required. Pinning fixes code identity, while an allow-list restricts
     permitted actions. See
     [GitHub's policy documentation](https://docs.github.com/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization).

   - _Workflow permissions_: **Read repository contents and packages
     permissions**. Nothing needs the create-and-approve-pull-requests tick box:
     the release job publishes straight from a push to `main` and opens no PR.

   **Settings → Repository → Rulesets → New ruleset** — name it
   `main: PR required, no force-push, no deletion`, enforcement **Active**,
   target **all repositories** and the **default branch**. Enable: restrict
   deletions, block force pushes, and require a pull request with **0
   approvals** plus **require conversation resolution before merging**. Add
   **Organization admin** as a bypass actor set to **Always**.

   **Required checks are scoped separately.** Require the four reported checks
   from `self-ci.yml` for `.tooling` now: Build & tests, Workflow lint, Secret
   scan, and Renovate config. Verify their actual check names on a PR first;
   keep Dependency audit advisory. Product CI checks belong in repository rules
   or an org ruleset targeting only repositories that report them, not the
   all-repository rule above. Do not grant the AI App bypass access.

   **Repository-level check.** The Actions workflow permission also exists per
   repository and an existing repo keeps its own value, so setting the org
   default does not necessarily flip it. Confirm and fix `.tooling` directly:

   ```sh
   gh api repos/hogasi/.tooling/actions/permissions/workflow
   gh api -X PUT repos/hogasi/.tooling/actions/permissions/workflow \
     -F default_workflow_permissions=read
   ```

2. **Nothing to configure for publishing.** GitHub Packages authenticates with
   the workflow's own `GITHUB_TOKEN`, so there is no registry account, no secret
   and no trusted publisher to set up.

3. **Keep the `hogasi` org on npmjs, empty.** Packages ship to GitHub Packages,
   but they are still named `@hogasi/*`. Holding the scope on the public
   registry stops anyone else claiming it, so a repo with a broken `.npmrc`
   falls back to nothing rather than to a stranger's code.
4. **Account and integration enrollment** — managed outside the tooling files:
   - Org → Settings → Authentication security → **Require two-factor
     authentication**. Your own account must have 2FA on first, or you get
     locked out of the org.
   - Store `CLAUDE_CODE_OAUTH_TOKEN` as an organization Actions secret,
     generated with `claude setup-token`. Grant selected enrolled repositories
     access. Verify Fable access first: Max/premium seats include it within
     limits; Pro needs usage credits. Do not enable paid overage as an implicit
     fallback.
   - Set `AI_ROLES` as an Actions variable for enrolled repositories: `planner`
     first, then `planner,implementer` once approval and CI are proven. Unset
     means disabled. An org variable can supply a shared value; repository
     overrides take precedence, so clearing the org value is not a global stop.
   - Claude model defaults belong in `.tooling/.github/workflows/ai.yml`:
     planner `fable`, implementer `opus`, effort `high`. Only create
     `AI_PLANNER_MODEL`, `AI_IMPLEMENTER_MODEL`, `AI_PLANNER_EFFORT`, or
     `AI_IMPLEMENTER_EFFORT` Actions variables when overriding those defaults.
     Variables on the tooling repository alone do not configure consumers.
   - Connect each enrolled repo in Codex settings and enable automatic reviews.
     Verify whether GPT-6 Astra can be selected and record the actual model
     selection capability. Hosted review cannot be configured by an
     `AI_REVIEWER_MODEL` workflow variable. If exact Astra selection is
     unavailable, obtain an explicit decision before adopting another model or
     an API-backed reviewer. Verify App-authored PRs and follow-up reviews.
   - Create the `hogasi-ai` GitHub App with webhook **off**. Grant contents,
     pull requests, and issues read/write, plus metadata, actions and
     administration read — actions read is how a repair reads its own failing
     check logs, and administration read is how the route job reads back the
     sender's repository permission before admitting an event, and the approval
     job that of the actor recording, clearing, or verifying approval, including
     the recheck after an implementation leaves its queue. If that lookup is
     refused the approval fails rather than being assumed; phase A should
     confirm the grant is sufficient. Install on enrolled repositories; store
     its key and **client id** as organization Actions secrets
     `AI_APP_PRIVATE_KEY` and `AI_APP_ID` — the workflow passes that secret to
     `create-github-app-token`'s `client-id`, because its `app-id` input is
     deprecated. Grant both secrets to each enrolled repo. The workflow mints a
     token per job, scoped to that job's permissions.
   - Add the thin AI caller below, explicitly forwarding the three named
     secrets, and provision `ready` and `approved` labels. Add
     [review-guidelines.md](../agents/review-guidelines.md) to the consumer's
     `AGENTS.md`. Complete this again for new repositories; copying a workflow
     does not grant secret access or connect Codex automatically.

     ```yaml
     # .github/workflows/ai.yml in the enrolled repository
     name: AI

     on:
       issues:
         types: [opened, edited, labeled]
       issue_comment:
         types: [created]

     jobs:
       ai:
         uses: hogasi/.tooling/.github/workflows/ai.yml@v1
         # Everything Claude writes goes through the App token the reusable
         # workflow mints, so GITHUB_TOKEN only ever reads. A called workflow
         # cannot hold a permission its caller did not grant, so these are the
         # ceiling for every job inside it.
         permissions:
           actions: read
           contents: read
           issues: read
           pull-requests: read
         secrets:
           AI_APP_ID: ${{ secrets.AI_APP_ID }}
           AI_APP_PRIVATE_KEY: ${{ secrets.AI_APP_PRIVATE_KEY }}
           CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
     ```

   - Keep CI required and independent of AI enablement. To stop Claude writes
     across repositories, suspend the App and cancel AI runs. Disable hosted
     Codex reviews separately. Record credential rotation and renewal steps when
     validating the sandbox.
   - Install the **Renovate** GitHub App on the org (github.com/apps/renovate),
     all repositories. **Previously recorded as not installed**; recheck with
     `gh api orgs/hogasi/installations` before treating that snapshot as
     current. Needed now for this repo's dependencies, and at Stage 1 for
     consumers.
5. **Drop the `delete_repo` scope** now that the personal repo is deleted. If
   the token still carries it, remove it with:
   `gh auth refresh -h github.com -r delete_repo`.
