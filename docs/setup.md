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
     first, then `planner,plan-reviewer`, then
     `planner,plan-reviewer,implementer` once approval and CI are proven. Unset
     means disabled. An org variable can supply a shared value; repository
     overrides take precedence, so clearing the org value is not a global stop.
   - Claude defaults belong in `.tooling/.github/workflows/ai.yml`: planner
     `fable`, implementer `opus`, effort `high`. Their model and effort Actions
     variables override those defaults only in the consumer.
   - Plan review now uses the subscription runner with `gpt-6-astra` and
     `medium` reasoning. `agents/route.mjs` validates the consumer's
     `AI_PLAN_REVIEWER_MODEL` and `AI_PLAN_REVIEWER_EFFORT`; the pilot accepts
     only Astra and `low` or `medium`. Clear obsolete `opus` or `high` review
     overrides before enrollment. PR review through this runner is still
     pending; do not enable hosted reviews as a fallback.
   - Complete the private-consumer subscription setup below before enabling
     `plan-reviewer`. `AI_REVIEW_APP_LOGIN` defaults to `hogasi-review[bot]`;
     set it in the consumer only if using a differently named reviewer App.
     Approval trusts records from that login, never the `reviewed` label alone.
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
   - Add the thin AI caller below, explicitly mapping the six named secrets, and
     provision `ready`, `reviewed` and `ready for dev` labels. Add
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
         uses: hogasi/.tooling/.github/workflows/ai.yml@FULL_COMMIT_SHA
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
           CODEX_AUTH_JSON: ${{ secrets.CODEX_AUTH_JSON }}
           AI_REVIEW_APP_ID: ${{ secrets.AI_REVIEW_APP_ID }}
           AI_REVIEW_APP_PRIVATE_KEY: ${{ secrets.AI_REVIEW_APP_PRIVATE_KEY }}
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

## Astra subscription preflight

The first implementation step adds
[the subscription check](../.github/workflows/codex-review.yml). It does not yet
replace either reviewer. It proves `gpt-6-astra` at `medium` reasoning on a
GitHub-hosted runner before we connect the issue and PR routes. Light is called
`low` in the CLI; compare it with medium on known defects before changing
defaults.

Use only a trusted **private** consumer, initially `hogasi/ai-sandbox`. Do not
run account-auth automation in public `.tooling`, copy the login to other
consumers, or share it with a desktop session. A shared login across
repositories needs a central execution queue; repository concurrency groups
cannot provide that lock.

1. Create the `codex-review` GitHub environment in the consumer. Restrict its
   deployment branches to the default branch. The workflow itself also rejects
   public repositories and non-default branches. Limit workflow editing to
   trusted maintainers.
2. Create a separate `hogasi-review` GitHub App with the webhook disabled and
   install it only on the private consumer. Grant Actions, Contents and Metadata
   read; Issues, Pull requests and Environments write. Keep the existing
   `hogasi-ai` App's permissions unchanged. Save the review App's **client ID**
   as `AI_REVIEW_APP_ID` and its generated PEM private key as
   `AI_REVIEW_APP_PRIVATE_KEY`, both environment secrets in `codex-review`. Only
   the persistence step requests environment-write access, after Codex exits.
3. Use a current Codex CLI on a trusted local machine to create a dedicated
   login in a separate credential directory. Configure file-backed credential
   storage, authenticate using your subscription, and seed `CODEX_AUTH_JSON` as
   an **environment secret** in `codex-review`. Never paste its contents in
   chat, issues or logs. Do not create an API key or enable paid overage.
4. Commit the tooling change and use its full commit SHA in this temporary
   consumer caller, committed to the consumer's default branch:

   ```yaml
   name: Codex subscription check
   on:
     workflow_dispatch:
   jobs:
     check:
       uses: hogasi/.tooling/.github/workflows/codex-review.yml@FULL_COMMIT_SHA
       permissions:
         contents: read
       secrets:
         CODEX_AUTH_JSON: ${{ secrets.CODEX_AUTH_JSON }}
         AI_REVIEW_APP_ID: ${{ secrets.AI_REVIEW_APP_ID }}
         AI_REVIEW_APP_PRIVATE_KEY: ${{ secrets.AI_REVIEW_APP_PRIVATE_KEY }}
   ```

   All three secrets belong to the called job's `codex-review` environment; the
   caller must explicitly map those names as shown. In the sandbox, omitting the
   mappings delivered empty values even with the environment and optional secret
   declarations present. The environment supplies the values when the called job
   starts; do not duplicate credentials at repository level or use
   `secrets: inherit`. Keep the existing `AI_APP_*` credentials reserved for
   discovery and implementation.

5. Run it twice, then queue three runs. Confirm all execute, the model check
   passes, persistence succeeds, and the environment secret's update timestamp
   advances. These calls consume subscription allowance and Actions minutes.
   They do not prove long-term token renewal; the local synthetic rotation test
   verifies write-back of changed credentials, and live renewal must be
   observed.

On September 10, 2026,
[sandbox run 34481335939](https://github.com/hogasi/ai-sandbox/actions/runs/34481335939)
passed with the explicit mappings: credential restore, Astra medium access,
reviewer App authentication, credential write-back and cleanup all succeeded.
The secret update timestamp advanced to `2026-09-10T13:14:20Z`.
[The repeat run](https://github.com/hogasi/ai-sandbox/actions/runs/34482741591)
also passed using the saved login. Three runs dispatched in quick succession
then completed sequentially without cancellation:

| Run                                                                          | Execution window (UTC, September 10, 2026) | Result |
| ---------------------------------------------------------------------------- | ------------------------------------------ | ------ |
| [34482977797](https://github.com/hogasi/ai-sandbox/actions/runs/34482977797) | 13:30:22–13:30:48                          | Passed |
| [34482981484](https://github.com/hogasi/ai-sandbox/actions/runs/34482981484) | 13:30:52–13:31:16                          | Passed |
| [34482985724](https://github.com/hogasi/ai-sandbox/actions/runs/34482985724) | 13:31:21–13:31:52                          | Passed |

Each queued run passed Astra medium access, credential write-back and cleanup.
This completes the subscription preflight, including repeat use and queue
behavior. It does not prove live token rotation or long-term renewal.

The runner pins Codex `0.154.0`, uses an empty working directory, and reads no
consumer code. It saves the current login even if the model fails, then deletes
the runner's authentication directory. Model output is not logged. A failed step
produces a failed run and a short recovery message; it never falls back to the
API. A hard runner termination can prevent persistence. If a login is lost or
revoked, stop queued runs, reseed it and repeat this check.

## Enable issue-plan review

The plan-review route is implemented locally; its live verdict tests remain
pending. After merging and pinning this version in the consumer AI caller:

1. Explicitly map the three review secret names through the AI caller as shown
   above. Keep their values only in the `codex-review` environment. Discovery
   and implementation jobs never receive those credentials.
2. Set `AI_ROLES=planner,plan-reviewer`; remove old Claude reviewer overrides.
3. Exercise a deliberately defective proposal and verify findings remove `ready`
   without applying `reviewed`. Correct it and reapply `ready` to check a
   passing review, then owner approval.
4. Edit a passed proposal and verify approval is rejected. Reapply `ready` to
   obtain a review for the new body. A default-branch commit also invalidates
   the old pass. Test a queued review whose proposal changes before completion.
5. Enable `implementer` only after these checks pass. Existing label-only Claude
   reviews need a fresh Astra pass before new implementation or repair runs.

Plan reviews share the smoke test's subscription queue. The runner supplies the
full thread and committed repository text as data, with shell, browser and
execution tools disabled. It runs no repository scripts or dependency installs.
The pilot rejects prompts over 512 KiB and repositories with submodules; binary
files are listed as unavailable evidence. Add scoped read-only retrieval before
enrolling larger repositories. Do not increase the limit without checking the
model's context budget.

A pending reviewer record and removal of `reviewed` precede model execution.
Trusted code validates the JSON verdict and rechecks the proposal digest and
repository SHA before publishing. Approval repeats these checks, including after
the implementation queue. GitHub cannot atomically update comments and labels,
so the authenticated record and current inputs are authoritative. A failed run
stays unreviewed; inspect its Actions error and remove/reapply `ready` after
fixing the cause. Credential persistence still runs after a model failure.
Long-term token renewal and the actual review quality still need live
validation. The next implementation step is the Astra PR-review route.

Sources:
[Codex account auth in CI](https://learn.chatgpt.com/docs/auth/ci-cd-auth),
[model and effort selection](https://learn.chatgpt.com/docs/models),
[GitHub secret timing](https://docs.github.com/en/actions/reference/security/secrets),
and
[concurrency queues](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
