import assert from "node:assert/strict";
import test from "node:test";

import { context, stackFixture } from "./delivery-fixture.mjs";
import { deliveryTarget, writerIssue } from "./stack-target.mjs";

test("an authorized child targets only its approved prerequisite branch", () => {
  const state = stackFixture();
  const target = deliveryTarget(
    { ...context, issueNumber: "3" },
    state.request
  );
  assert.equal(target.base, "claude/issue-2");
  assert.equal(target.prerequisite.number, 7);
  assert.equal(target.writer, "1");
  assert.equal(
    writerIssue({ ...context, issueNumber: "2" }, state.request),
    "1"
  );
});

test("independent child delivery targets its parent integration branch", () => {
  const state = stackFixture();
  const target = deliveryTarget(
    { ...context, issueNumber: "2" },
    state.request
  );
  assert.equal(target.base, "claude/issue-1");
  assert.equal(target.prerequisite, null);
});

test("a prerequisite without its own owner authorization cannot supply a stack base", () => {
  const state = stackFixture();
  state.issues[1].labels = [];
  assert.throws(
    () => deliveryTarget({ ...context, issueNumber: "3" }, state.request),
    /ready for dev/
  );
});

test("foreign or retargeted prerequisite PRs cannot supply code to a child", () => {
  const state = stackFixture();
  state.pull.base.ref = "unapproved";
  assert.throws(
    () => deliveryTarget({ ...context, issueNumber: "3" }, state.request),
    /base no longer matches/
  );
  state.pull.base.ref = "claude/issue-1";
  state.pull.head.repo.full_name = "foreign/repo";
  assert.throws(
    () => deliveryTarget({ ...context, issueNumber: "3" }, state.request),
    /exactly one open App/
  );
});
