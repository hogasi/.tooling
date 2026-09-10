import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { claimRepair, resolveRepair } from "./repair.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);
const digest = createHash("sha256").update("10\nApproved scope").digest("hex");
const context = {
  appLogin: "builder[bot]",
  ciWorkflow: ".github/workflows/ci.yml",
  defaultBranch: "main",
  eventName: "workflow_run",
  repository: "org/repo",
  reviewerLogin: "reviewer[bot]",
  runId: "101",
  senderLogin: "builder[bot]",
  sourceKind: "ci",
  sourceRunId: "100"
};
function fixture() {
  const issue = {
    labels: [{ name: "ready for dev" }],
    number: 1,
    state: "open"
  };
  const pull = {
    base: { ref: "main", repo: { full_name: "org/repo" }, sha: base },
    draft: false,
    head: { ref: "claude/issue-1", repo: { full_name: "org/repo" }, sha: head },
    number: 2,
    state: "open",
    user: { login: context.appLogin }
  };
  const run = {
    conclusion: "failure",
    event: "pull_request",
    head_repository: { full_name: "org/repo" },
    head_sha: head,
    id: 100,
    path: context.ciWorkflow,
    pull_requests: [{ number: 2 }],
    run_attempt: 1,
    status: "completed"
  };
  const comments = [
    {
      body: "<!-- hogasi-ai proposal -->\nApproved scope",
      created_at: "2026-09-10T10:00:00Z",
      id: 10,
      updated_at: "2026-09-10T10:00:00Z"
    },
    { body: '<!-- hogasi-ai planning {"proposal":10} -->', id: 11 },
    {
      body: `<!-- hogasi-ai authorization ${JSON.stringify({ actor: "owner", digest, event: 20, proposal: 10 })} -->`,
      id: 12
    }
  ].map((comment) => ({ ...comment, user: { login: context.appLogin } }));
  const reviews = [
    {
      body: `<!-- hogasi-review pr key=test -->\n<!-- hogasi-review result ${JSON.stringify({ base, digest, head, run: "100", status: "changes_requested" })} -->\nFix the defect.`,
      commit_id: head,
      state: "COMMENTED",
      user: { login: context.reviewerLogin }
    }
  ];
  const jobs = [
    { conclusion: "success", name: "ai / PR review / subscription" }
  ];
  const reads = new Map([
    ["repos/org/repo/actions/runs/100", run],
    ["repos/org/repo/actions/runs/100/attempts/1/jobs", [{ jobs }]],
    ["repos/org/repo/issues/1", issue],
    ["repos/org/repo/issues/1/comments", [comments]],
    [
      "repos/org/repo/issues/1/events",
      [[{ event: "labeled", id: 20, label: { name: "ready for dev" } }]]
    ],
    ["repos/org/repo/issues/1/labels", issue.labels],
    ["repos/org/repo/pulls/2", pull],
    ["repos/org/repo/pulls/2/reviews", [reviews]]
  ]);
  const ci = { ...run };
  reads.set(`repos/org/repo/actions/runs?head_sha=${head}&per_page=100`, [
    { workflow_runs: [ci] }
  ]);
  const writes = [];
  const request = (options) => {
    if (!options.method) {
      assert.ok(reads.has(options.path), options.path);
      return reads.get(options.path);
    }
    writes.push(options);
    if (options.path.endsWith("/comments")) {
      comments.push({
        body: options.body.body,
        id: 13,
        user: { login: context.appLogin }
      });
    } else if (options.method === "PATCH") {
      comments.at(-1).body = options.body.body;
    }
    return {};
  };
  return { ci, comments, issue, jobs, pull, request, reviews, run, writes };
}
const reviewContext = {
  ...context,
  eventName: "repository_dispatch",
  pullRequestNumber: "2",
  sourceKind: "review"
};
function reviewFixture() {
  const state = fixture();
  state.run.path = ".github/workflows/ai.yml";
  state.run.event = "pull_request_target";
  return state;
}
test("only a current failed enrolled CI run routes the authorized owner and issue", () => {
  const state = fixture();
  const decision = resolveRepair(context, state.request);
  assert.equal(decision.owner, "owner");
  assert.equal(decision.issue, "1");
  assert.equal(decision.head, head);
  assert.equal(decision.role, "implementer");
  assert.equal(decision.approval, "verify");
});
for (const change of [
  (state) => {
    state.run.path = ".github/workflows/arbitrary.yml";
  },
  (state) => {
    state.run.conclusion = "cancelled";
  },
  (state) => {
    state.run.head_repository.full_name = "outside/fork";
  },
  (state) => {
    state.run.head_sha = "c".repeat(40);
  },
  (state) => {
    state.pull.draft = true;
  },
  (state) => {
    state.pull.state = "closed";
  },
  (state) => {
    state.pull.user.login = "human";
  }
]) {
  test("stale, foreign, draft, closed or unrelated failures do not start repairs", () => {
    const state = fixture();
    change(state);
    assert.equal(resolveRepair(context, state.request).role, "");
    assert.equal(state.writes.length, 0);
  });
}
test("current reviewer findings require the exact App sender and successful review job", () => {
  const state = reviewFixture();
  assert.equal(resolveRepair(reviewContext, state.request).role, "implementer");
  assert.throws(
    () =>
      resolveRepair({ ...reviewContext, senderLogin: "owner" }, state.request),
    /Untrusted/
  );
  state.jobs[0].conclusion = "failure";
  assert.throws(
    () => resolveRepair(reviewContext, state.request),
    /not succeeded/
  );
});
test("forged or stale reviewer records cannot grant a repair", () => {
  const state = reviewFixture();
  state.ci.conclusion = "success";
  state.reviews[0].user.login = "human";
  assert.equal(resolveRepair(reviewContext, state.request).role, "");
  state.reviews[0].user.login = context.reviewerLogin;
  state.pull.base.sha = "c".repeat(40);
  assert.equal(resolveRepair(reviewContext, state.request).role, "");
});
test("CI and review events for the same head consume one attempt under the writer lock", () => {
  const state = fixture();
  assert.equal(
    claimRepair({ ...context, expectedHead: head }, state.request).count,
    1
  );
  state.run.path = ".github/workflows/ai.yml";
  state.run.event = "pull_request_target";
  assert.equal(
    claimRepair({ ...reviewContext, expectedHead: head }, state.request),
    null
  );
  assert.equal(state.writes.length, 1);
});
test("queued head changes and removed authorization prevent any repair claim", () => {
  const state = fixture();
  assert.equal(
    claimRepair({ ...context, expectedHead: "c".repeat(40) }, state.request),
    null
  );
  state.issue.labels = [];
  assert.throws(
    () => claimRepair({ ...context, expectedHead: head }, state.request),
    /ready for dev/
  );
  assert.equal(state.writes.length, 0);
});

test("verified CI and reviewer passes reset the cycle without invoking another repair", () => {
  const state = fixture();
  claimRepair({ ...context, expectedHead: head }, state.request);
  state.run.conclusion = "success";
  state.ci.conclusion = "success";
  state.reviews[0].body = state.reviews[0].body.replace(
    '"changes_requested"',
    '"pass"'
  );
  assert.equal(
    claimRepair({ ...context, expectedHead: head }, state.request),
    null
  );
  assert.match(state.comments.at(-1).body, /"count":0/);
  assert.match(state.comments.at(-1).body, /"keys":\[\]/);
});
test("a superseded CI run cannot start a repair for the same commit", () => {
  const state = fixture();
  state.ci.id = 102;
  state.ci.conclusion = "success";
  assert.equal(resolveRepair(context, state.request).role, "");
});

test("malformed Actions collections fail closed instead of dropping verification evidence", () => {
  const state = fixture();
  const malformed = (options) =>
    options.path.includes("?head_sha=")
      ? [{ workflow_runs: null }]
      : state.request(options);
  assert.throws(() => resolveRepair(context, malformed), /Malformed Actions/);
  assert.equal(state.writes.length, 0);
});
