# Manual setup

This is the checklist of intended GitHub settings, not proof that they are
applied. Apply and verify them during enrollment; record the verification date.
The AI files described in [stage 2](stage-2-ai-layer.md) exist now. Sandbox
evidence is recorded below; other repositories need their own enrollment.

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
     `planner,plan-reviewer,implementer` once approval and CI are proven, then
     add `pr-reviewer` for PR feedback. Unset means disabled. An org variable
     can supply a shared value; repository overrides take precedence, so
     clearing the org value is not a global stop.
   - Claude defaults belong in `.tooling/.github/workflows/ai.yml`: planner
     `fable`, implementer `opus`, effort `high`. Their model and effort Actions
     variables override those defaults only in the consumer.
   - Plan review now uses the subscription runner with `gpt-6-astra` and
     `medium` reasoning. `agents/route.mjs` validates the consumer's
     `AI_PLAN_REVIEWER_MODEL` and `AI_PLAN_REVIEWER_EFFORT`; the pilot accepts
     only Astra and `low` or `medium`. Clear obsolete `opus` or `high` review
     overrides before enrollment. PR review uses the same defaults, with
     separate `AI_PR_REVIEWER_MODEL` and `AI_PR_REVIEWER_EFFORT` variables. No
     hosted or API fallback is enabled.
   - Complete the private-consumer subscription setup below before enabling
     `plan-reviewer`. `AI_REVIEW_APP_LOGIN` defaults to `hogasi-review[bot]`;
     set it in the consumer only if using a differently named reviewer App.
     Approval trusts records from that login, never the `approved` label alone.
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
     provision the v2 labels below. Add
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
       pull_request_target:
         types: [opened, ready_for_review, synchronize]
       repository_dispatch:
         types: [ai-correction]
       workflow_run:
         workflows: [CI]
         types: [completed]

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
     across repositories, suspend the builder App and cancel AI runs. Suspend
     the reviewer App and cancel review runs to stop reviewer activity. Record
     credential rotation and renewal steps when validating the sandbox.
   - Install the **Renovate** GitHub App on the org (github.com/apps/renovate),
     all repositories. **Previously recorded as not installed**; recheck with
     `gh api orgs/hogasi/installations` before treating that snapshot as
     current. Needed now for this repo's dependencies, and at Stage 1 for
     consumers.
5. **Drop the `delete_repo` scope** now that the personal repo is deleted. If
   the token still carries it, remove it with:
   `gh auth refresh -h github.com -r delete_repo`.

## Astra subscription preflight

The smoke mode of
[the subscription runner](../.github/workflows/codex-review.yml) proves
`gpt-6-astra` at `medium` reasoning on a GitHub-hosted runner before we connect
the issue and PR routes. Light is called `low` in the CLI; compare it with
medium on known defects before changing defaults.

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

The runner pins Codex `0.154.0` and uses an empty working directory. Smoke mode
reads no consumer code; review modes receive committed text as input. It saves
the current login even if the model fails, then deletes the runner's
authentication directory. Model output is not logged. A failed step produces a
failed run and a short recovery message; it never falls back to the API. A hard
runner termination can prevent persistence. If a login is lost or revoked, stop
queued runs, reseed it and repeat this check.

## Workflow v2 migration

Delivery 1 changes the proposal and approval format. Migrate one private
consumer at a time; do not mix legacy approval with the checkpoint format.

1. Pause AI_ROLES and finish active writers before updating the caller to this
   tooling SHA. Keep independent CI enabled.
2. Provision learning, in review, changes requested, approved, in development,
   blocked, and ready for dev labels. Existing reviewer secrets/grants suffice.
   The builder approval token requests Actions read to date the owner event.
3. Enable planner and plan-reviewer. For existing issues, remove ready for dev
   and ask the planner to migrate the existing proposal. It preserves the body,
   creates a checkpoint and updates its planning summary. Remove legacy
   ready/reviewed labels; they authorize nothing in this version.
4. Check the original description is unchanged. Correct scope through a new
   checkpoint with revision rationale. Retain the old checkpoint and maintain
   only one planning summary and one reviewer summary.
5. After a pass, enable implementer and apply ready for dev. Verify summary
   edits retain authorization, while checkpoint edits, replacement and
   authorization removal/reapplication require fresh authorization.
6. Advance main with an unrelated change and request a scoped repair. Confirm no
   scope reapproval is needed. Test stale events and queued scope changes.

Reviews still reject stale code snapshots before publication. Owner approval
binds to the checkpoint, not every main commit. Legacy body-based approvals are
rejected. Automatic corrections and stacks follow in later deliveries; see
[stage 2](stage-2-ai-layer.md).

The following evidence predates v2 migration and proves the earlier workflow. On
September 10, 2026,
[sandbox issue #9](https://github.com/hogasi/ai-sandbox/issues/9) proved these
paths:

- [34489967879](https://github.com/hogasi/ai-sandbox/actions/runs/34489967879):
  rejected a test-only proposal that also required a source and documentation
  change.
- [34490343652](https://github.com/hogasi/ai-sandbox/actions/runs/34490343652):
  passed the corrected proposal.
- [34490627619](https://github.com/hogasi/ai-sandbox/actions/runs/34490627619):
  rejected owner approval after the body changed; implementation was skipped.
- [34490912218](https://github.com/hogasi/ai-sandbox/actions/runs/34490912218):
  passed a fresh review of the changed proposal.
- [34491101961](https://github.com/hogasi/ai-sandbox/actions/runs/34491101961):
  accepted owner approval and opened
  [PR #10](https://github.com/hogasi/ai-sandbox/pull/10). Its independent
  [Tests run](https://github.com/hogasi/ai-sandbox/actions/runs/34491349999)
  passed.

An actual proposal change during a queued/model review and long-term token
renewal still need live validation.

## Enable PR review

The PR route is implemented; its live sandbox validation remains pending. After
merging this tooling version:

1. Update the consumer caller's full SHA and add the three `pull_request_target`
   event types shown above. Merge that caller onto the default branch.
2. Add `pr-reviewer` to the consumer's `AI_ROLES`. Existing reviewer secrets and
   App grants suffice. The full enrollment value is
   `planner,plan-reviewer,implementer,pr-reviewer`.
3. Open an implementation PR, push a repair, or mark an existing draft ready.
   For sandbox PR #10, convert it to draft and then mark it ready to exercise
   the new route. Confirm a `hogasi-review` COMMENT review names its exact head.
4. Rerun the successful workflow: identical base, head, proposal, model and
   effort must skip the model call and produce no duplicate review.
5. Exercise a known defect, an owner-requested `@claude` repair and a new-head
   review. Verify required CI independently, then merge as owner. Also test a
   stale review and plan/PR runs queued together before broader enrollment.

Only open, non-draft, same-repository PRs authored by the implementation App on
`claude/issue-<n>` against the default branch qualify. Events must come from
that App or a human with repository write/admin permission. The linked issue
must retain its exact owner-approved checkpoint and active authorization. PR
feedback uses that approved scope; it does not require the old plan-review base
to equal the new base. Implementation and repair approval gates still require a
current plan pass.

The runner captures the three-dot diff, committed base and head files, approved
proposal, PR comments, prior reviews and Actions results for that head. The
combined prompt has the same 512 KiB limit; submodules fail and binary contents
are unavailable. It checks out the trusted base, executes no PR scripts and runs
Codex without tools. Snapshot collection disables Git diff drivers and text
conversion. CI is a captured observation: pending or missing runs do not count
as passed tests, and CI completion alone does not trigger another review.

Before publication, trusted code rechecks base, head and approval. Changed input
fails visibly; retry using a current PR event. Reviews are COMMENT feedback, not
merge approval or an automatic repair request. The owner requests repairs with
`@claude`; new commits trigger another review. Smoke, plan and PR modes share
the same subscription queue and credential persistence. GitHub cannot atomically
compare PR state and post a review; every review includes its exact commit and
proposal digest so later changes cannot make it current evidence.

Sources:
[Codex account auth in CI](https://learn.chatgpt.com/docs/auth/ci-cd-auth),
[model and effort selection](https://learn.chatgpt.com/docs/models),
[GitHub secret timing](https://docs.github.com/en/actions/reference/security/secrets),
and
[concurrency queues](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## Automatic plan corrections

After pinning this release, add the repository_dispatch trigger above. The
review workflow dispatches only current changes-requested findings. The receiver
requires the builder App as sender, verifies the source workflow and completed
plan-review job, and re-reads the current checkpoint and reviewer record.

The planner shares one serialized issue queue with human planning runs. Before
invoking Fable it claims an attempt in a maintained correction record. Duplicate
evidence spends nothing. Three attempts persist across new proposal revisions;
further automatic work sets blocked and stops. An authorized human planning
reply explicitly resumes the conversation and resets that cycle. Missing scope
or product decisions still require the owner.

Only the verified automatic planner invocation allows the exact builder bot in
Claude's actor check. Other bot comments remain excluded. The dispatcher has a
separate short-lived builder token with Contents write (required for repository
dispatch) and Issues read; the planner itself still cannot write code. Reviewer
credentials are not passed to this dispatcher or to Claude.

Validate a known defective checkpoint → Astra finding → automatic Fable revision
→ fresh review, without an owner relay. Also test duplicate dispatch, forged
sender/source and exhaustion. Automatic PR repairs and draft PR creation are the
next increment; PR repairs still use owner @claude comments in this release.

### Planner publication

The planner model has read-only GitHub access and returns a structured proposal
or discovery question. Trusted `agents/planning-run.mjs` captures the request
before the model runs and publishes its validated result afterward: immutable
checkpoint first, maintained summary second, review label last. Publication
failure fails the job. The model cannot edit the original issue or authorize
implementation. `agents/planning.mjs` rejects changed scope, closed issues,
development authorization and malformed output before writes.

This is required because the GitHub MCP server bundled with the pinned Claude
action can create issue comments but cannot edit an existing summary comment.

### Automatic PR repairs

The caller receives completed `CI` runs on its default branch. If the consumer
uses another CI workflow name, change `workflow_run.workflows`; set
`AI_CI_WORKFLOW` to its exact path (default `.github/workflows/ci.yml`). The
router re-reads the enrolled run and current same-repository App PR, and skips
stale, draft, closed, foreign or unrelated work. Reviewer handoffs require the
exact builder App and a successful trusted PR-review job with current structured
review evidence. No PR code runs in routing or dispatch.

The original authorizing owner's current permission and unchanged proposal are
verified before and after queueing. CI and review events for one base/head/scope
share a persisted claim under the issue writer lock. The budget is three repairs
per cycle; a current CI pass plus reviewer pass resets it without calling Opus.
An authorized `@claude` repair explicitly resets the budget after exhaustion.
Quota, canceled CI and infrastructure failures do not create automatic retries.
The implementer opens an early draft, keeps it draft while working, and marks
ready after its checks pass. Merges remain human-controlled.
