import assert from "node:assert/strict";
import test from "node:test";

import { readApprovedProposal } from "./approval.mjs";
import { context, stackFixture } from "./delivery-fixture.mjs";
import { planningPulls, verifyPlanningPulls } from "./plan-evidence.mjs";

test("a parent plan captures existing native child PRs without requiring child reauthorization", () => {
  const state = stackFixture();
  const approved = readApprovedProposal(context, state.request);
  state.issues[1].labels = [];
  const pulls = planningPulls(context, approved, state.request);
  assert.deepEqual(
    pulls.map((pull) => pull.number),
    [7, 8]
  );
  assert.equal(pulls[0].head, state.pull.head.sha);
  assert.equal(pulls[1].baseRef, state.pull.head.ref);
  assert.doesNotThrow(() =>
    verifyPlanningPulls(context, { ...approved, pulls }, state.request)
  );
});

test("a child plan includes its open prerequisite PR as review evidence", () => {
  const state = stackFixture();
  const scope = { ...context, issueNumber: "3" };
  const approved = readApprovedProposal(scope, state.request);
  const pulls = planningPulls(scope, approved, state.request);
  assert.deepEqual(
    pulls.map((pull) => pull.number),
    [7, 8]
  );
});

test("changed or foreign referenced PRs prevent publication of a plan review", () => {
  for (const change of [
    (pull) => {
      pull.head.sha = "f".repeat(40);
    },
    (pull) => {
      pull.base.ref = "different-base";
    },
    (pull) => {
      pull.state = "closed";
    },
    (pull) => {
      pull.user.login = "someone-else";
    },
    (pull) => {
      pull.head.repo.full_name = "foreign/repo";
    }
  ]) {
    const state = stackFixture();
    const approved = readApprovedProposal(context, state.request);
    const pulls = planningPulls(context, approved, state.request);
    change(state.pull);
    assert.throws(
      () => verifyPlanningPulls(context, { ...approved, pulls }, state.request),
      /Referenced PR changed/
    );
  }
});

test("a newly opened related PR invalidates a plan review captured without it", () => {
  const state = stackFixture();
  const approved = readApprovedProposal(context, state.request);
  let isVisible = false;
  const request = (options) =>
    !isVisible &&
    options.path.includes("/pulls?") &&
    options.path.includes("issue-2")
      ? [[]]
      : state.request(options);
  const pulls = planningPulls(context, approved, request);
  assert.deepEqual(
    pulls.map((pull) => pull.number),
    [8]
  );
  isVisible = true;
  assert.throws(
    () => verifyPlanningPulls(context, { ...approved, pulls }, request),
    /Referenced PR changed/
  );
});
