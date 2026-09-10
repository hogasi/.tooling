import assert from "node:assert/strict";
import test from "node:test";

import { context, stackFixture } from "./delivery-fixture.mjs";
import { parentIntegrationRoute, stackReviewRoute } from "./stack-review.mjs";

const reviewContext = {
  ...context,
  ciWorkflow: ".github/workflows/ci.yml",
  sourceRunId: "99"
};

function fixture() {
  const state = stackFixture();
  const run = {
    conclusion: "success",
    event: "pull_request",
    head_repository: { full_name: context.repository },
    head_sha: state.upper.head.sha,
    id: 99,
    path: reviewContext.ciWorkflow,
    pull_requests: [{ number: 8 }],
    status: "completed"
  };
  const request = (options) => {
    if (options.path.endsWith("/actions/runs/99")) {
      return run;
    }
    if (options.path.includes("/actions/runs?")) {
      return [{ workflow_runs: [run] }];
    }
    return state.request(options);
  };
  return { ...state, request, run };
}

test("current enrolled CI routes a dependent PR review through the default-branch workflow", () => {
  const state = fixture();
  const result = stackReviewRoute(reviewContext, state.request);
  assert.equal(result.role, "pr-reviewer");
  assert.equal(result.issue, "3");
  assert.equal(result.pull, "8");
  assert.equal(result.base, state.pull.head.sha);
  assert.equal(result.writer, "1");
});

test("foreign, stale, draft and unrelated workflow results cannot request a stack review", () => {
  for (const change of [
    (state) => {
      state.run.path = ".github/workflows/untrusted.yml";
    },
    (state) => {
      state.run.head_repository.full_name = "foreign/repo";
    },
    (state) => {
      state.run.head_sha = "f".repeat(40);
    },
    (state) => {
      state.upper.draft = true;
    },
    (state) => {
      state.run.event = "push";
    }
  ]) {
    const state = fixture();
    change(state);
    assert.equal(stackReviewRoute(reviewContext, state.request), null);
  }
});

test("the dependency must still match when a queued review starts", () => {
  const state = fixture();
  state.upper.base.ref = "unapproved";
  assert.throws(
    () => stackReviewRoute(reviewContext, state.request),
    /unapproved dependency/
  );
});

test("only a current enrolled parent branch run refreshes parent integration", () => {
  const state = fixture();
  state.run.event = "push";
  state.run.head_branch = "claude/issue-1";
  const request = (options) => {
    if (options.path.includes("/git/ref/heads/")) {
      return { object: { sha: state.upper.head.sha } };
    }
    if (options.path.includes("/commits/")) {
      return [[]];
    }
    return state.request(options);
  };
  assert.equal(parentIntegrationRoute(reviewContext, request).issue, "1");
  state.run.head_sha = "f".repeat(40);
  assert.equal(parentIntegrationRoute(reviewContext, request), null);
  state.run.head_sha = state.upper.head.sha;
  state.run.path = ".github/workflows/foreign.yml";
  assert.equal(parentIntegrationRoute(reviewContext, request), null);
});
