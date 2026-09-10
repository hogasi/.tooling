# Stage 2 — development directly in GitHub

The goal is discovery, planning, implementation, testing, review and repair
inside GitHub, with explicit owner authorization and owner merge. Fable plans,
Opus builds and writes tests, subscription Codex (`gpt-6-astra`, `medium`)
reviews, and independent CI runs tests. There is no separate tester or API
fallback. Credentials remain in the private consumer; no always-on server.

## Delivery status

The previous body-based workflow passed live sandbox plan rejection/correction,
stale approval rejection, implementation, deliberate PR defect detection, manual
repair, new-head review and duplicate suppression on September 10, 2026.
[PR #10](https://github.com/hogasi/ai-sandbox/pull/10) holds the PR evidence.

Workflow v2 is being delivered in three increments:

1. **Proposal records and approval:** implemented in this change; requires the
   coordinated migration and live checks in
   [setup](setup.md#workflow-v2-migration).
2. **Automatic correction:** plan handoff is implemented in this increment,
   pending live validation. Authenticated findings return to Fable with a
   persisted three-attempt limit. CI/PR repair handoffs and early draft PRs are
   the next increment; they are not enabled yet.
3. **Child delivery and stacks:** approved, not implemented. Parent issues hold
   shared goals; children have their own reviewed deliverable and authorization.
   Independent PRs target main; dependent PRs use same-repository stacks.

Do not enable future handoffs by simply allowing arbitrary bots. Trusted code
must authenticate the source, re-read current state and claim each attempt.

## Proposal and state contract

The owner issue body remains the original request. Fable maintains one planning
summary comment and creates a complete checkpoint only for a meaningful review
submission. Each checkpoint includes the problem, intended user, outcome,
decisions with evidence, scope, acceptance criteria, implementation steps,
verification and revision rationale. Prior checkpoints remain readable.

The checkpoint begins with `<!-- hogasi-ai proposal -->` followed by a newline.
The summary begins with `<!-- hogasi-ai planning {"proposal":123456} -->`, where
123456 is the actual checkpoint comment ID. During discovery the pointer is
null. The summary links the current revision, explains current decisions and
links meaningful earlier revisions. It is navigation, not approved scope.

`agents/proposal.mjs` reads all comment pages, checks the publisher App
identity, requires the summary to reference the latest checkpoint and rejects
edited, deleted, empty or superseded checkpoints. The digest includes comment ID
and exact proposal text, so an identical-text replacement is still a new
revision.

| Status              | Meaning and owner                                                    |
| ------------------- | -------------------------------------------------------------------- |
| `learning`          | Discovery is gathering evidence or waiting for owner answers.        |
| `in review`         | Planner submitted a complete revision; reviewer is checking it.      |
| `changes requested` | Reviewer found actionable gaps.                                      |
| `approved`          | Reviewer passed this revision; implementation is not authorized yet. |
| `in development`    | Owner authorized the revision; implementation/repair may proceed.    |
| `blocked`           | A workflow cannot proceed and needs attention.                       |

These status labels are mutually exclusive when reconciled by
`agents/state.mjs`. Other user labels are preserved. `ready for dev` is a
separate owner authorization action, retained while implementation is
authorized. Labels are a visible projection, never proof of reviewer or owner
authority.

The reviewer updates one App-owned findings summary instead of posting start and
finish comments on every run. It includes the checkpoint link, verdict,
findings, captured repository SHA and run link. A pending record supersedes a
pass before model execution. Approval requires an authenticated pass for the
checkpoint; an old label or human-copied record cannot grant it.

The owner applies `ready for dev` after review passes. Trusted code reads the
actual label event and records its ID, owner and proposal digest. The revision
and passing review must predate that event, and the event must predate the
workflow run. If they fall in the same timestamp second, reapply the label:
ambiguous ordering fails rather than approving a later revision. Replaying an
old run cannot approve a new label event. Removing/reapplying the label requires
fresh authorization; it cannot revive a previous record.

Verification after queueing checks the exact approved checkpoint, active label
event, open issue and owner write permission. A change to main alone does not
revoke approved scope. A new proposal, modified checkpoint, revoked owner
permission or removed authorization does. Editing the navigation summary or
original request does not silently change implementation scope; use
`@claude replan` to revoke approval and publish a replacement proposal.

## Current role handoffs

An authorized human opens an issue or comments during discovery to start Fable.
Fable applies `in review`; only that narrow builder-App label event starts plan
review. The owner applies `ready for dev` for implementation. Ordinary comments
on authorized issues do nothing. `@claude replan` revokes authorization and
returns to discovery. `@claude` on an implementation PR requests a scoped
repair. Plan findings now return to Fable automatically through a verified
default-branch handoff. PR correction remains manual until the next delivery-2
increment.

The planner reads the repo-adapted grilling instructions in `agents/planner.md`
and the vendored upstream skill. It asks only material owner decisions; code
facts are its responsibility. The planner cannot push or open a PR. UX,
architecture and documentation checks are explicit planner responsibilities;
specialist investigation is conditional, not a mandatory extra agent.

## Review execution and writes

The existing PR route accepts open, non-draft, same-repository App-authored
`claude/issue-<n>` PRs against the default branch on opened, ready_for_review
and synchronize events. It validates the owner-approved checkpoint and supplies
the three-dot diff, committed base/head text, discussion and Actions results for
the head. Reviewer tools are disabled. No PR scripts or dependency installs run
in the privileged reviewer. Stacks are not yet admitted by this route.

The complete prompt is limited to 512 KiB. Submodules fail visibly; binary
contents are unavailable. Larger repos need scoped retrieval before enrollment.
The runner rechecks proposal and code revisions before publishing COMMENT
feedback tied to the head, not merge approval. Matching
base/head/proposal/model/ effort inputs suppress duplicate model calls.
Pending/missing CI is not a pass; CI completion alone does not start another PR
review in delivery 1.

Plan, PR and smoke modes share one `codex-subscription` queue per consumer.
Persist the subscription login after model execution, including model failures,
then clear runner credentials. One login cannot be shared across repositories
without central serialization. The reviewer App and builder App stay separate.
GitHub comment/label writes are not atomic; readers recheck records and scope. A
hard runner termination can prevent persistence; stop queued runs and reseed
credentials before retrying if the login is lost.

## Files and settings

| Responsibility           | Tooling location                                                                            | Consumer setting                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Event routing and models | `agents/route.mjs`, `.github/workflows/ai.yml`                                              | `AI_ROLES`; `AI_PLANNER_MODEL/EFFORT`, `AI_IMPLEMENTER_MODEL/EFFORT` |
| Proposal checkpoints     | `agents/proposal.mjs`, `agents/planner.md`                                                  | Issue comments; original body unchanged                              |
| State and approval       | `agents/state.mjs`, `agents/approval.mjs`                                                   | Provision labels and apply owner authorization                       |
| Plan verdicts            | `agents/review.mjs`, `agents/plan-reviewer.md`                                              | `AI_PLAN_REVIEWER_MODEL/EFFORT`                                      |
| PR verdicts              | `agents/pr-review.mjs`, `agents/pull-request.mjs`, `agents/pr-reviewer.md`                  | `AI_PR_REVIEWER_MODEL/EFFORT`                                        |
| Runner and snapshots     | `agents/review-run.mjs`, `agents/review-snapshot.mjs`, `.github/workflows/codex-review.yml` | Private consumer, default-branch environment restriction             |
| Credentials              | `agents/codex-auth.mjs`                                                                     | Three reviewer environment secrets, explicit caller mappings         |
| Local conventions        | `agents/review-guidelines.md`                                                               | Consumer README, AGENTS.md and CLAUDE.md                             |

Reviewer defaults are Astra medium; explicit low effort is allowed. There is no
hosted-model setting or API fallback. Claude defaults are Fable/Opus high. Role
enablement is explicit and unset means disabled. Variables belong to the
consumer; values on public tooling do not enroll it. Workflow and prompt
versions are pinned together through the reusable workflow's commit identity.

## Completion evidence

Each delivery must pass `pnpm check`, actionlint, secret scanning and its
sandbox scenarios before consumer rollout. CI remains independently required.
Full v2 completion includes automatic correction, human escalation, scope
revocation, duplicate/stale events, child delivery, stack repair and conflict
handling. Merges remain human-controlled. Long-term subscription renewal still
requires observation; successful write-back is not proof of indefinite renewal.

## Plan handoff implementation

`agents/automation.mjs` authenticates the source review and manages persisted
correction budgets. `.github/workflows/ai-dispatch.yml` emits the narrow
ai-correction repository event. `agents/route-run.mjs` handles CLI I/O and
trusted handoff resolution; `agents/route.mjs` retains ordinary event/model
policy. Only current plan findings can start an automatic planner run. The same
issue queue serializes manual and automatic planning. Claims are written before
the model starts; a failed run consumes its attempt rather than retrying
forever.

Delivery-1 sandbox evidence: issue #12 retained its original body byte-for-byte,
created checkpoint 5621729482 and one planning summary, and passed Astra review
in run 34500160824. Run 34500349398 recorded authorization and implemented PR
#14. After a separate main documentation update, repair run 34500811470 reused
the same authorization; CI and Astra passed repaired head
ad5855a2f9b5ddb57a5cf0f3da2045f26bc22d23. No issue reapproval was needed.

The first live automatic correction test used sandbox issue #16. Astra run
34503039037 rejected the seeded missing export, documentation and tests;
repository-dispatch run 34503467054 invoked Fable without an owner relay. Fable
published checkpoint 5622180528, but its MCP server could not update the summary
pointer; review 34503758905 correctly rejected the stale pointer before calling
the model. The publication fix moves all planner writes into trusted workflow
code using structured model output. Its live retest remains pending.
