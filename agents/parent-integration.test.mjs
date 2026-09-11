import assert from "node:assert/strict";
import test from "node:test";

import { readApprovedProposal } from "./approval.mjs";
import { context, stackFixture } from "./delivery-fixture.mjs";
import { refreshDelivery } from "./delivery-progress.mjs";
import {
  createParentBranch,
  draftParentRepair,
  finalizeParentPull,
  parentDeliveries,
  updateParentPull
} from "./parent-integration.mjs";
import { resolveRepair } from "./repair.mjs";

function fixture() {
  const state = stackFixture();
  const refs = [];
  const writes = [];
  const parent = { pull: null };
  const request = (options) => {
    if (options.method) {
      writes.push(options);
      if (options.path.endsWith("/git/refs")) {
        refs.push({ object: { sha: options.body.sha }, ref: options.body.ref });
      } else if (options.path.endsWith("/pulls")) {
        parent.pull = {
          ...options.body,
          base: {
            ref: options.body.base,
            repo: { full_name: context.repository }
          },
          head: {
            ref: options.body.head,
            repo: { full_name: context.repository },
            sha: "e".repeat(40)
          },
          node_id: "parent-pr",
          number: 9,
          state: "open",
          user: { login: context.appLogin }
        };
        return parent.pull;
      } else if (options.path.endsWith("/pulls/9")) {
        parent.pull.body = options.body.body;
      }
      return {};
    }
    return read(options.path);
  };
  const read = (path) => {
    if (path.includes("/matching-refs/")) {
      return refs;
    }
    if (path.endsWith("/git/ref/heads/main")) {
      return { object: { sha: "b".repeat(40) } };
    }
    if (path.includes("/pulls?") && path.includes("issue-1")) {
      return [parent.pull ? [parent.pull] : []];
    }
    if (path.includes("/actions/runs?")) {
      const pull = path.includes(state.pull.head.sha)
        ? state.pull
        : state.upper;
      return [
        {
          workflow_runs: [
            {
              conclusion: "success",
              event: "pull_request",
              head_sha: pull.head.sha,
              id: 99,
              path: context.ciWorkflow,
              pull_requests: [{ number: pull.number }],
              status: "completed"
            }
          ]
        }
      ];
    }
    return readEvidence(path);
  };
  const readEvidence = (path) => {
    if (path.endsWith("/reviews")) {
      const pull = path.includes("/7/") ? state.pull : state.upper;
      const approved = readApprovedProposal(
        { ...context, issueNumber: pull === state.pull ? "2" : "3" },
        state.request
      );
      const record = {
        base: pull.base.sha,
        baseRef: pull.base.ref,
        digest: approved.digest,
        head: pull.head.sha,
        status: "pass"
      };
      return [
        [
          {
            body: `key\n<!-- hogasi-review result ${JSON.stringify(record)} -->`,
            commit_id: pull.head.sha,
            id: 900,
            state: "COMMENTED",
            user: { login: context.reviewerLogin }
          }
        ]
      ];
    }
    return state.request({ path });
  };
  return { ...state, parent, refs, request, writes };
}

test("parent branch creation is idempotent and never resets existing commits", () => {
  const state = fixture();
  createParentBranch(context, state.request);
  assert.deepEqual(state.refs, [
    { object: { sha: "b".repeat(40) }, ref: "refs/heads/claude/issue-1" }
  ]);
  state.refs[0].object.sha = "f".repeat(40);
  createParentBranch(context, state.request);
  assert.equal(state.writes.length, 1);
  assert.equal(state.refs[0].object.sha, "f".repeat(40));
});

test("the first verified child integration opens a parent draft without closing child issues", () => {
  const state = fixture();
  assert.equal(updateParentPull(context, state.request), null);
  state.pull.merged_at = "2026-09-10T15:00:00Z";
  const pull = updateParentPull(context, state.request);
  assert.equal(pull.draft, true);
  assert.equal(pull.base.ref, "main");
  assert.equal(pull.complete, false);
  assert.equal(state.issues[1].state, "open");
  assert.equal(state.issues[2].state, "open");
  assert.match(pull.body, /integrated by #7/);
  assert.match(pull.body, /pending integration/);
});

test("all child integrations become closing references only in the final parent PR", () => {
  const state = fixture();
  state.pull.merged_at = "2026-09-10T15:00:00Z";
  state.upper.merged_at = "2026-09-10T15:10:00Z";
  state.upper.stack = { base: { ref: "claude/issue-1" } };
  assert.equal(parentDeliveries(context, state.request).complete, true);
  const pull = updateParentPull(context, state.request);
  assert.equal(pull.complete, true);
  assert.match(pull.body, /Closes #1\nCloses #2\nCloses #3/);
  assert.equal(
    state.issues.every((issue) => issue.state === "open"),
    true
  );
});

test("parent progress counts verified integrations while child issues remain open", () => {
  const state = fixture();
  state.pull.merged_at = "2026-09-10T15:00:00Z";
  refreshDelivery(context, state.request);
  const write = state.writes.find((entry) => entry.path.includes("/comments"));
  assert.match(write.body.body, /\[x\] #2/);
  assert.match(write.body.body, /\[ \] #3/);
  assert.equal(
    state.issues.every((issue) => issue.state === "open"),
    true
  );
});

test("parent readiness requires its own latest combined CI, not a child run at the same commit", () => {
  const state = fixture();
  state.pull.merged_at = "2026-09-10T15:00:00Z";
  state.upper.merged_at = "2026-09-10T15:10:00Z";
  state.upper.stack = { base: { ref: "claude/issue-1" } };
  updateParentPull(context, state.request);
  const runs = [
    {
      conclusion: "success",
      event: "pull_request",
      head_sha: state.parent.pull.head.sha,
      id: 100,
      path: context.ciWorkflow,
      pull_requests: [{ number: 7 }],
      status: "completed"
    }
  ];
  const mutations = [];
  const request = (options) => {
    if (
      options.path.includes(
        `/actions/runs?head_sha=${state.parent.pull.head.sha}`
      )
    ) {
      return [{ workflow_runs: runs }];
    }
    if (options.path.endsWith("/pulls/9") && !options.method) {
      return structuredClone(state.parent.pull);
    }
    if (options.path === "graphql") {
      mutations.push(options);
      const draft = options.body.query.includes("convertPullRequestToDraft");
      state.parent.pull.draft = draft;
      return { data: { transition: { pullRequest: { isDraft: draft } } } };
    }
    return state.request(options);
  };
  finalizeParentPull(context, request);
  assert.equal(mutations.length, 0);
  runs.push({
    ...runs[0],
    conclusion: "failure",
    id: 101,
    pull_requests: [{ number: 9 }]
  });
  finalizeParentPull(context, request);
  assert.equal(mutations.length, 0);
  runs.push({ ...runs[1], conclusion: "success", id: 102 });
  finalizeParentPull(context, request);
  assert.equal(state.parent.pull.draft, false);
  assert.equal(mutations.length, 1);
  const head = state.parent.pull.head.sha;
  draftParentRepair(context, { callGitHub: request, pull: state.parent.pull });
  assert.equal(state.parent.pull.draft, true);
  finalizeParentPull(context, request);
  assert.equal(state.parent.pull.draft, false);
  assert.equal(state.parent.pull.head.sha, head);
  assert.equal(mutations.length, 3);
  runs.push({ ...runs[1], conclusion: "failure", id: 103 });
  finalizeParentPull(context, request);
  assert.equal(state.parent.pull.draft, true);
  assert.equal(mutations.length, 4);
});

test("combined CI can repair a draft parent only after all children integrate", () => {
  const state = fixture();
  state.pull.merged_at = "2026-09-10T15:00:00Z";
  updateParentPull(context, state.request);
  const run = {
    conclusion: "failure",
    event: "pull_request",
    head_repository: { full_name: context.repository },
    head_sha: state.parent.pull.head.sha,
    id: 99,
    path: context.ciWorkflow,
    pull_requests: [{ number: 9 }],
    status: "completed"
  };
  const scope = {
    ...context,
    eventName: "workflow_run",
    sourceKind: "ci",
    sourceRunId: "99"
  };
  const request = (options) => {
    if (options.path.endsWith("/issues/9/comments")) {
      return [[]];
    }
    if (options.path.endsWith("/actions/runs/99")) {
      return run;
    }
    if (options.path.includes(`/actions/runs?head_sha=${run.head_sha}`)) {
      return [{ workflow_runs: [run] }];
    }
    if (options.path.endsWith("/pulls/9")) {
      return structuredClone(state.parent.pull);
    }
    return state.request(options);
  };
  assert.equal(resolveRepair(scope, request).role, "");
  state.upper.merged_at = "2026-09-10T15:10:00Z";
  state.upper.stack = { base: { ref: "claude/issue-1" } };
  updateParentPull(context, state.request);
  assert.equal(resolveRepair(scope, request).role, "implementer");
  assert.equal(resolveRepair(scope, request).issue, "1");
  state.parent.pull.user.login = "someone-else";
  assert.equal(resolveRepair(scope, request).role, "");
});

test("parent delivery rejects a child whose only passing CI belongs to another PR", () => {
  const state = fixture();
  state.pull.merged_at = "2026-09-10T15:00:00Z";
  const run = {
    conclusion: "success",
    event: "pull_request",
    head_sha: state.pull.head.sha,
    id: 101,
    path: context.ciWorkflow,
    pull_requests: [{ number: 9 }],
    status: "completed"
  };
  const request = (options) =>
    options.path.includes(`/actions/runs?head_sha=${state.pull.head.sha}`)
      ? [{ workflow_runs: [run] }]
      : state.request(options);
  const delivery = parentDeliveries(context, request);
  assert.equal(delivery.deliveries[0].integration, null);
  assert.equal(updateParentPull(context, request), null);
});

test("unchanged parent progress does not edit the PR or retrigger edited CI", () => {
  const state = fixture();
  state.pull.merged_at = "2026-09-10T15:00:00Z";
  updateParentPull(context, state.request);
  const writes = state.writes.length;
  updateParentPull(context, state.request);
  assert.equal(state.writes.length, writes);
});
