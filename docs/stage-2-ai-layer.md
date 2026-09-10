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

1. **Proposal records and approval:** implemented and live-tested, including
   unchanged original requests and repair after an unrelated main update.
   Consumer migration is documented in [setup](setup.md#workflow-v2-migration).
2. **Automatic correction:** authenticated plan findings return to Fable with a
   persisted three-attempt limit and trusted structured-output publication.
   CI/PR repair and early draft publication are implemented and live-tested;
   duplicate competing repairs were suppressed and the repair budget reset.
3. **Child delivery:** native links, inherited scope and separate authorization
   are implemented; live validation is pending. Parent issues hold shared goals;
   children have their own reviewed deliverable and authorization. Independent
   PRs target their parent integration branch. Dependencies can form native
   stacks within that parent; only the top-level parent PR targets main.

Do not enable future handoffs by simply allowing arbitrary bots. Trusted code
must authenticate the source, re-read current state and claim each attempt.

## Proposal and state contract

The owner issue body remains the original request. Fable returns structured
planning output; trusted publication maintains one planning summary and creates
a complete checkpoint only for a meaningful review submission. Each checkpoint
includes the problem, intended user, outcome, decisions with evidence, scope,
acceptance criteria, implementation steps, verification and revision rationale.
Prior checkpoints remain readable.

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
Trusted planner publication applies `in review`; only that narrow builder-App
label event starts plan review. The owner applies `ready for dev` for
implementation. Ordinary comments on authorized issues do nothing.
`@claude replan` revokes authorization and returns to discovery. `@claude` on an
implementation PR requests a scoped repair. Plan findings now return to Fable
automatically through a verified default-branch handoff. Current enrolled CI
failures and authenticated reviewer findings use the same scoped implementer
after approval verification, a queued head recheck and a persisted repair claim.

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
in the privileged reviewer. Child PR reviews use the enrolled CI completion
handoff to the default-branch caller, validate the current approved parent or
prerequisite base, and include inherited parent context. The privileged caller
must restrict PR-target events to the default branch.

Parent/child plan reviews also receive the related open App PR snapshots and the
agent runtime modules from the pinned tooling commit, excluding tests and
fixtures. The reviewer does not need source-code dumps in issue comments.
Referenced PR inputs are checked again before publication; changed or newly
opened related PRs invalidate the in-flight review. All code is read as
committed blobs, with no checkout or execution of that code.

The complete prompt is limited to 512 KiB. Submodules fail visibly; binary
contents are unavailable. Larger repos need scoped retrieval before enrollment.
The runner rechecks proposal and code revisions before publishing COMMENT
feedback tied to the head, not merge approval. Matching
base/head/proposal/model/ effort inputs suppress duplicate model calls.
Pending/missing CI is not a pass. Child CI completion can request review;
repeated input is deduplicated.

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
code using structured model output. Its live retest is recorded below.

## PR repair implementation

`agents/repair.mjs` resolves trusted CI and reviewer evidence against the
current eligible PR and approved proposal. `agents/repair-evidence.mjs`
validates the latest enrolled CI run and structured reviewer result.
`agents/repair-run.mjs` dispatches or claims this work; it does not run PR code.
The router derives the original owner's identity from the authenticated approval
record, and existing approval jobs recheck that owner's permission before and
after queueing.

CI and review share one claim for the base/head/proposal digest. Three automatic
attempts persist across commits. Verified current CI and reviewer passes finish
the cycle without a model call; owner repair requests explicitly resume it.
Stale sources start nothing. A draft parent with all children integrated may
receive bounded repair for failing combined CI. Other drafts start nothing.
Planner and builder queues use GitHub's
[`queue: max`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency)
so later events do not replace pending work; the platform ceiling is 100 pending
jobs per group. Required CI and human merge remain independent gates.

### Live automatic plan correction

Sandbox [issue #19](https://github.com/hogasi/ai-sandbox/issues/19) passed the
complete loop. Review 34505217173 rejected a deliberately incomplete checkpoint;
automatic Fable run 34505386642 published revision 2 through trusted code.
Review 34505667131 found an incorrect expectation for ESM missing-export
failure; automatic run 34505819721 corrected it. Review 34506079861 passed
revision 3, checkpoint 5622465549, digest
`d893c1b508e7e0595343d00648fc4731f5f1b08c93265e8fb097d8817ae38789`. No owner
message relayed either finding. API assertions confirmed the original body
unchanged, three unedited checkpoints, one planning summary, one reviewer
summary, one persisted counter at 2/3 and final `approved` status. Development
remained unauthorized throughout this test.

## Automatic repair evidence

Sandbox PR #14 received a deliberate `farewell` regression at
`0c277e0a903bccafb48cbbe7c0679c2a3271ed54`. CI run 34507052256 failed and Astra
run 34507051648 requested changes. Opus run 34507099298 repaired only the source
line at `be01eed158f0803300277263db8c437b76d26a93`; CI 34507419137 and Astra
34507413117 passed. Competing review dispatch 34507207654 skipped its Claude
step after acquiring the writer; completion run 34507556173 reset the budget to
0/3 without a model call.

Sandbox PR #22 was observed as a draft while implementation run 34507084538 was
active. It was created at 17:19:05Z and marked ready at 17:20:04Z on September
10, 2026. CI 34507470641 and Astra 34507572530 passed. Tooling PR #20
subsequently aligned the builder runtime with `.nvmrc` (Node 24.19.0 fallback)
and authenticated git checkout using the scoped App token; sandbox PR #23
enrolled that fix.

## Child delivery implementation

`agents/planner.schema.json` defines structured deliverables. Their readable
scope and dependency metadata are included in the immutable proposal by
`agents/delivery-plan.mjs`. After parent owner authorization,
`agents/delivery.mjs` creates or reuses native sub-issues and issue
dependencies, then dispatches child discovery. Partial retries reconnect
existing children instead of duplicating them. The parent path invokes no
implementation model.

`agents/delivery-scope.mjs` verifies inherited checkpoint identity, exact child
scope, parent authorization and native links during planning and approval.
`agents/delivery-evidence.mjs` verifies reviewed child integrations into their
parent branch, including current approved scope and enrolled CI.
`agents/delivery-progress.mjs` maintains one parent summary after child PR
merges. Original issue bodies and previous checkpoints remain intact.

Native endpoints are documented by GitHub for
[sub-issues](https://docs.github.com/en/rest/issues/sub-issues) and
[issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies).
Child implementations still need their own reviewed proposals and owner labels.
`agents/parent-integration.mjs` owns integration branches, draft parent PRs,
combined CI readiness and final closing references. `agents/stack-target.mjs`
resolves approved parent or prerequisite bases. `agents/stack.mjs` registers
native stacks; `agents/stack-refresh.mjs` refreshes downstream layers with
current-head checks. `agents/stack-review.mjs` authenticates CI handoffs so
privileged review continues to run from the default branch. One parent-family
writer serializes branch mutations; the parent PR is excluded from child stacks.
These changes still require the live parent and stack rollout tests before
claiming deployment complete.

### Parent integration rollout evidence

The sandbox caller pins tooling `04317e095eb366a3babf196308129098dee65f35` after
[sandbox PR #37](https://github.com/hogasi/ai-sandbox/pull/37). All 343 tooling
tests and required CI checks passed. Live checks on September 10, 2026
established:

- [Parent #31](https://github.com/hogasi/ai-sandbox/issues/31) passed planning
  review and authorization.
  [Run 34526494746](https://github.com/hogasi/ai-sandbox/actions/runs/34526494746)
  created `claude/issue-31` and children #34/#35, with #35 natively blocked by
  #34. Captured parent and child bodies remain byte-identical.
- Initial parent CI exposed missing router `contents: read` permission.
  [Tooling PR #26](https://github.com/hogasi/.tooling/pull/26) fixed it;
  [replay 34527544879](https://github.com/hogasi/ai-sandbox/actions/runs/34527544879)
  passed routing and delivery tracking.
- The migration plan for
  [parent #25](https://github.com/hogasi/ai-sandbox/issues/25) passed
  [review 34528074599](https://github.com/hogasi/ai-sandbox/actions/runs/34528074599)
  using both existing child PR snapshots and the complete pinned runtime source.
  The same checkpoint passed after the missing evidence was supplied; it did not
  need another proposal revision.
- [Authorization run 34528257887](https://github.com/hogasi/ai-sandbox/actions/runs/34528257887)
  created `claude/issue-25`, reused children #26/#27 without changing their
  bodies, and dispatched fresh inherited discovery. Existing PRs #28/#29 remain
  unmerged pending that child authorization.
- Child #35 passed review after automatic correction of its prerequisite
  comparison. Claude runs for #34 and #26 subsequently failed before model usage
  with `is_error: true` and no structured output. The action did not expose the
  underlying error or retain a diagnostic artifact, so an account limit or
  authentication cause is not confirmed. No partial plan was published.

Still unverified live: child retargeting and integration into the parent, first
integration opening the draft parent PR, combined parent CI/readiness/review,
native stack repair and downstream refresh, and final parent merge closing its
children. Resume child discovery after Claude execution recovers; each child
still needs its own reviewed checkpoint and owner authorization. Do not merge
the old main-targeting child PRs as a workaround.
