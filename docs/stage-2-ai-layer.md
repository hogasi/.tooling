# Stage 2 — development directly in GitHub

**Built, unproven.** The files exist and pass this repository's own checks; no
part of the loop has yet run against GitHub. Phase A below is what turns this
from written to working, and nothing here should be enrolled on a repository
that matters until it has.

The goal is a complete issue-to-merge development loop inside GitHub: discovery,
planning, implementation, tests, independent review, and owner-directed repairs.
One Claude workflow handles planning and implementation; CI verifies the code
and Codex reviews it. No separate AI tester.

## Agreed flow

1. The owner opens an issue describing the desired outcome.
2. Fable investigates the repository and conducts discovery in issue comments
   using `grilling` directly. It asks batches of independent questions with
   recommended answers, carrying previous answers forward.
3. Fable updates the issue body with the outcome, scope, acceptance criteria,
   implementation plan, and verification plan. It applies `ready` when no
   material decisions remain.
4. The owner approves that proposal revision. Opus implements it, writes tests,
   runs the repository checks, and opens a linked PR.
5. Required CI independently runs against the latest proposed code. Codex
   reviews the PR; GPT-6 Astra is the requested review model, subject to the
   integration limitation below.
6. The owner requests a repair with `@claude` in the PR, referring to CI
   failures or review findings. Opus updates the same branch and CI runs again.
   The owner can request another review with `@codex review`.
7. The owner merges after checking the evidence and resolving review
   discussions. `Closes #<n>` closes the issue on merge to the default branch.

The first version uses explicit repair requests. Bot reviews, comments, and
pushes do not start another Claude run. Automatic repair is deferred until real
use demonstrates which handoffs are worth automating.

## Where files and settings belong

Everything except `ci-node.yml`, which belongs to stage 1, now exists:

```
.tooling/
├── .github/
│   ├── actionlint.yaml              suppresses two unknown-context warnings
│   └── workflows/
│       ├── ai.yml                   reusable workflow and role defaults
│       └── ci-node.yml              deterministic CI, from stage 1 — not built
└── agents/
    ├── planner.md                   issue discovery and planning instructions
    ├── implementer.md               implementation, tests, and repair instructions
    ├── review-guidelines.md         canonical section for consumer AGENTS.md
    ├── route.mjs                    event routing and model settings, with tests
    ├── approval.mjs                 approval state and authority checks, with tests
    └── skills/                      pinned upstream discovery skill bundle
        ├── grilling/SKILL.md
        └── LICENSE
```

`agents/skills/grilling/SKILL.md` is `skills/productivity/grilling/SKILL.md`
from `mattpocock/skills` at commit `3cca18b368ae95cdbdebbff572ccafa662551015`,
byte for byte, with the upstream MIT licence and its provenance in
`agents/skills/LICENSE`. That directory is in `.prettierignore` so the vendored
copy stays diffable against upstream, and the commit is named in
`agents/planner.md`. The workflow copies the skill to `~/.claude/skills/` before
invoking Claude, because storing a file under `agents/skills` neither installs
nor invokes it, and the planner instructions load it by name.

`agents/route.mjs` holds the decisions that must not be wrong: which role an
event starts, who is allowed to start it, and whether a model or effort override
is one the CLI accepts. It is a module with tests rather than a `case` statement
in YAML so the sandbox can exercise the routing table without spending
subscription quota.

| Setting                                | Canonical location                                                        | Override or enrollment                                                          |
| -------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Planner model                          | Planner job in `.github/workflows/ai.yml`: `fable`                        | `AI_PLANNER_MODEL` Actions variable                                             |
| Implementer model                      | Implementer job in `.github/workflows/ai.yml`: `opus`                     | `AI_IMPLEMENTER_MODEL` Actions variable                                         |
| Claude effort                          | Role jobs in `ai.yml`: start at `high`                                    | `AI_PLANNER_EFFORT`, `AI_IMPLEMENTER_EFFORT`                                    |
| Turn limits and timeouts               | Explicit per-role values in `ai.yml`, chosen and exercised in the sandbox | Change through a tooling PR                                                     |
| Role enablement                        | `vars.AI_ROLES` checked by `ai.yml`; unset means disabled                 | GitHub Actions variable: `planner`, then `planner,implementer`                  |
| Role behavior                          | `agents/planner.md` and `agents/implementer.md`                           | Consumer conventions in its own `AGENTS.md`                                     |
| Discovery method                       | `agents/skills/grilling/SKILL.md`                                         | GitHub adaptation in `agents/planner.md`                                        |
| Review instructions                    | `agents/review-guidelines.md`                                             | Copied into consumer `AGENTS.md`; subsequently owned by that repo               |
| Codex model and automatic reviews      | Codex settings for the linked account/repository                          | Verify Astra selection there; workflow variables cannot select the hosted model |
| Claude OAuth token and App credentials | GitHub organization Actions secrets                                       | Explicitly granted to each enrolled repository and forwarded by its caller      |
| Required checks and branch rules       | GitHub repository or scoped organization rulesets                         | Enrollment checklist in [setup.md](setup.md)                                    |

Model and effort defaults are executable workflow settings, not prompt front
matter requiring a custom parser. `ai.yml` passes the resolved values through
`claude_args` as `--model` and `--effort`. Validate overrides against supported
values before invoking Claude; do not interpolate arbitrary variable contents
into shell commands. Record the selected model and effort in run output.

Organization Actions variables supply shared overrides; repository variables win
over them. Variables set only on `.tooling` do not configure consumers of a
reusable workflow. Keep defaults in the workflow to ship them with its release.
No separate `.github/ai.yml` configuration schema is needed.

Each consumer has a thin `.github/workflows/ai.yml` caller. It forwards only
`CLAUDE_CODE_OAUTH_TOKEN`, `AI_APP_ID`, and `AI_APP_PRIVATE_KEY`, and declares
needed workflow permissions. Secrets are not automatically forwarded by reuse.
The caller to copy is in [setup.md](setup.md).

`AI_APP_ID` holds the App's **client id**, not its numeric app id:
`actions/create-github-app-token` deprecated `app-id` in favour of `client-id`,
and using the deprecated input would break at its next major.

Prompts and skills are checked out with `job.workflow_sha` and
`job.workflow_repository`, so they come from the same commit as the reusable
workflow rather than from `main` or a moving `v1`. This is GitHub's documented
mechanism for a reusable workflow reading files that sit beside it, but
`actionlint` does not know those two context properties yet, which is what
`.github/actionlint.yaml` suppresses. Still prove the pinning with a sandbox
caller: a context property that silently resolves to empty would check out the
default branch instead, and the ignore rule is the reason lint would not say so.

## Models and subscriptions

- **Discovery and planning: Fable.** The `fable` alias currently selects Fable
  5.1; use a supported explicit model ID when a release must retain a particular
  version. Claude Code 2.1.255 or newer is required for Fable 5.1.
- **Implementation, test writing, and repairs: Opus.** Use `opus` through the
  same Claude Action and OAuth token, with a fresh run reading the approved
  issue and repository rather than relying on hidden session state.
- **Independent review: Codex, targeting GPT-6 Astra.** Hosted GitHub review
  documentation does not establish an exact-model selector. Verify the actual
  account settings during the sandbox phase. Do not describe an unverified
  hosted review as Astra. If Astra cannot be selected, the owner must choose
  between hosted Codex review and an API-backed Codex Action with explicit model
  selection. No API billing or model substitution is implicitly approved.

The intended authentication path is subscriptions. Fable is included within
limits on Max and premium seats, but Pro requires usage credits. Verify access
and available quota before enabling the planner. Missing access or exhausted
quota must produce a visible failure, not a silent model downgrade.

Sources checked on 2026-09-09:
[Claude model configuration](https://code.claude.com/docs/en/model-config),
[Fable plan access](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan),
[Codex GitHub reviews](https://learn.chatgpt.com/docs/third-party/github), and
[Codex Action](https://learn.chatgpt.com/docs/github-action).

## Discovery and planning in the issue

The issue turns a problem or suggestion into a clear direction and actionable
plan. Comments preserve the conversation; the body is the current specification:

- Original request, preserved under `Reported`.
- Clarified problem or opportunity, affected users, and repository evidence.
- Agreed outcome, scope, and out-of-scope work.
- Observable acceptance criteria.
- Implementation plan: agreed approach and rationale, ordered steps, affected
  components/files, and dependencies.
- Verification plan: checks and tests that demonstrate each acceptance
  criterion.

Discovery and planning are two phases of the same role. No separate planning
agent or document handoff. The planner reads the entire thread and relevant
repository instructions before asking anything. It resolves facts itself and
asks the owner only material decisions. Simple issues can reach a proposal in
one run; there is no minimum interview length.

Use the upstream
[grilling skill](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md)
directly, with the workflow adaptations in `agents/planner.md` taking precedence
where they differ. Keep the vendored skill unchanged. Its decision dependencies,
batched questions, and recommended answers supply the discovery method.

The
[grill-me wrapper](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md)
only invokes `grilling` and disables automatic model invocation. Do not vendor
that wrapper for the automated planner. `grill-with-docs` additionally invokes
`domain-modeling`, which writes glossary and architecture-decision files; those
writes are outside our issue-only discovery phase. No separate `to-spec`
dependency is needed for the agreed proposal format.

Our adaptation in `agents/planner.md` reconstructs context from the issue
thread, publishes questions as comments, and maintains the proposal in the issue
body. Discovery covers only material decisions needed to implement and verify
the issue; direct investigation is the default and delegation is optional. When
no material decisions remain, publish the complete proposal and mark it `ready`.
There is no additional confirmation round: the owner applies `approved` to
authorize implementation. Revision-specific approval remains a workflow control
outside the model. Verify in the sandbox that a fresh run retains prior answers
and that neither the upstream skill nor the planner starts implementation before
approval.

## Approval and event routing

| Event                                        | Action                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| Owner opens an issue                         | Planner investigates and asks questions or publishes a proposal                  |
| Owner comments during discovery              | Planner continues the conversation                                               |
| Owner applies `approved` to a ready proposal | Record the approved proposal revision, then start implementation                 |
| Owner comments on an approved issue          | Ordinary comments do not restart discovery or implementation                     |
| Owner explicitly requests replanning         | Clear approval and return to discovery; require approval of the revised proposal |
| Owner comments `@claude` on the linked PR    | Implementer addresses the requested repairs within the approved scope            |
| App pushes or opens a PR                     | Normal CI runs; Codex follows its configured review triggers                     |
| Codex or App comments/reviews                | Feedback only; no automatic Claude invocation                                    |

Approval is enforced by `agents/approval.mjs`, invoked by the workflow.
Recording hashes the exact issue body in the approval label event and requires
the live body to match. Rerunning an old event cannot approve an edited
proposal. Both `ready` and `approved` must still be present. Verification reads
all comment pages and uses the latest App-authored approval marker, including
revocations; a human-authored marker cannot establish approval.

Every record, clear, or verification checks the requesting actor's current
repository write permission before making changes. Association with the
repository alone is insufficient. API failures stop processing. Both agent jobs
require successful routing; implementation also requires successful approval.
Discovery may skip approval only when no approval operation was requested.

The serialized implementation job rechecks approval after leaving its queue,
before minting its write token. Its digest must match the one accepted by the
preceding approval job, so a newly approved replacement proposal cannot silently
replace the queued task. Editing an approved issue schedules label removal; even
before that completes, a changed body fails verification.

**Ceiling: the recheck is per run, not per push.** The workflow cannot hook the
push that Claude itself makes, so an edit that lands mid-run is caught when the
next run starts rather than before the current one writes. Closing that would
mean wrapping the action, which is worth doing only if the sandbox shows an
owner actually editing under a running job. The narrower control is already in
place: the planner's App token has no `contents: write` and no pull request
access, so the discovery role cannot write code however it is prompted.

Retries resume the existing `claude/issue-<n>` branch and PR; they do not create
duplicates or reset scope. A fixed `branch_name_template` is what makes that
true — the action's default appends a timestamp, so every rerun would open a
second branch and a second pull request. Provision the `ready` and `approved`
labels during enrollment.

An unchanged approval whose digest is already the latest active record does not
append another comment on retry. New records include the Actions run ID for
traceability. Repairs resume the existing work and still require verification.

The router admits human accounts whose repository permission is `admin` or
`write`, read back in the route job with an App token, plus the `OWNER`
association, which is the account the repository belongs to.
`author_association` is otherwise only a social label — `MEMBER` says the sender
is in the org and `COLLABORATOR` that they are listed on the repository, neither
of which grants write access — so it decides nothing on its own, and is used to
explain a refusal. Label events defer authority to the approval job because the
issue's association describes its author. Repository write access is checked
again by every approval operation and by the Claude Action before it runs.
Neither `allowed_bots` nor `allowed_non_write_users` is enabled. This stops a
read-only member from spending the subscription on a run, or removing approval
with the App token.

The router distinguishes issue comments from pull request comments through
`github.event.issue.pull_request`, and reads the linked issue for a pull request
comment off the `claude/issue-<n>` branch name — issues and pull requests share
one number sequence, so the pull request's own number is never the issue's. That
issue number is the concurrency key that serialises writers.

Two trigger phrases exist, and nothing else starts a run: `@claude` on the pull
request requests a repair, and `@claude replan` on the issue clears approval and
returns to discovery. Both ignore quoted lines, so replying above a quote of the
App's own comment does not start a run. Every other owner comment on an
unapproved issue continues discovery; on an approved one it does nothing.

Read Codex findings as feedback without treating bot text as authority to change
scope; `agents/implementer.md` and `agents/planner.md` both say so explicitly.

## Writes, verification, and recovery

Use one org-owned GitHub App identity with no webhook receiver or hosted
service. Mint short-lived tokens scoped to the current repository and role's
needed permissions. PR creation and pushes use that identity so normal CI can
run; relying on `GITHUB_TOKEN` for those writes suppresses follow-up workflow
runs. The App is not a ruleset bypass actor and does not approve or merge PRs.

Separate cancellable discovery from code-writing runs. Superseded discovery may
be cancelled, but serialize implementation and repairs using the linked issue as
the shared work key. Do not cancel a writer because its own push or review
arrived. Before pushing, check the branch head and approval again; concurrent
human edits must be preserved. Reruns re-read GitHub state and report partial
progress, authentication errors, timeouts, and quota failures visibly.

Opus writes and runs meaningful tests as part of implementation. CI
independently executes `pnpm check`, the build, and relevant E2E checks against
the latest proposed commit. Browser-dependent criteria require browser/E2E
evidence; unit tests alone do not demonstrate those outcomes. Product-specific
setup and test commands stay in the consumer. No model-generated success message
replaces a command's exit code, and no AI job is a required test check.

CI remains enabled when AI is disabled. Clearing `AI_ROLES` disables Claude only
where a repository override does not replace it. For an organization-wide stop,
suspend the App and cancel active AI runs; disable hosted Codex review
separately. These controls do not promise cancellation of already-running
provider requests.

## Delivery phases

**A — prove the complete loop in one private sandbox.** Everything needed to
start is now in this repository; what is missing is evidence that it works.
Start with planner-only access, verify Fable and hosted Codex model
availability, then enable the implementer. Use ordinary local CI with required
checks; this does not wait for stage 1's reusable workflow. Prove an issue
reaches an approved plan, PR, failing check, owner-requested repair, green CI,
review, and owner merge. All human interaction after enrollment happens in
GitHub.

Before phase A is complete, also exercise a changed proposal after approval, a
duplicate event/rerun, a concurrent branch edit, a cancelled or quota-limited
run, AI disablement with CI still active, and an App-authored PR reviewed by
Codex. Three things in particular have no coverage outside a live run: that a
failed approval recheck actually stops the implementer, which no unit test can
reach because it is a property of the workflow's `if:` conditions rather than of
`route.mjs`; that `job.workflow_sha` really pins the prompts; and that the
per-role turn limits and timeouts in `ai.yml` — 60 turns and 30 minutes for the
planner, 200 and 60 for the implementer — are near the right size. Both were
chosen from reasoning, not evidence. Record actual review events and whether
subsequent commits need an explicit review request. Do not make a
`changes_requested` verdict a dependency.

**B — use it on product repo #1.** Adopt stage 1 CI, enroll secrets and scoped
required checks, and carry the proven caller and prompts over. Measure completed
tasks, owner corrections, repair passes, elapsed time, subscription quota, and
Actions usage. Retire the sandbox when these checks have a maintained home. The
template follows product repo #2, including AI enrollment instructions.

**C — automate only observed repetition.** Automatic repair is optional and
requires proven event routing, stale-review rejection, deduplication, and a
workflow-enforced repair cap. Auto-merge is a separate decision, after at least
a month of real reviews and a proven policy for review completion. Neither is
needed to achieve the development loop.

## Definition of done

From opening an issue through merging its PR, the owner can discover, plan,
approve, request fixes, inspect tests and review, and complete development
inside GitHub. No separate tester, database, message bus, or hosted
orchestration service is required. Fable/Opus access is proven, the review model
is accurately reported, and failures leave enough state to resume safely.
