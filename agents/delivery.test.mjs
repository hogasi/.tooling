import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { readApprovedProposal } from "./approval.mjs";
import { context, fixture, stackFixture } from "./delivery-fixture.mjs";
import { parentProgressRoute } from "./delivery-progress.mjs";
import { verifyInheritance } from "./delivery-scope.mjs";
import {
  claimChildDiscovery,
  createChildren,
  resolveChildDiscovery
} from "./delivery.mjs";
import { capturePlanning, publishPlanning } from "./planning.mjs";

test("approved decomposition creates native children and dependencies once, preserving the parent request", () => {
  const state = fixture();
  const children = createChildren(context, state.request);
  assert.deepEqual(
    children.map((child) => child.number),
    [2, 3]
  );
  assert.equal(state.parent.body, "Original parent request");
  assert.equal(state.linked.length, 2);
  assert.deepEqual(state.dependencies.get(3), [{ id: 101 }]);
  const created = state.writes.filter(
    (write) => write.path === "repos/org/repo/issues"
  ).length;
  createChildren(context, state.request);
  assert.equal(state.issues.length, 3);
  assert.equal(
    state.writes.filter((write) => write.path === "repos/org/repo/issues")
      .length,
    created
  );
  assert.equal(
    state.comments
      .get(1)
      .filter((comment) => comment.body.startsWith("<!-- hogasi-ai delivery "))
      .length,
    1
  );
});
test("a partial creation retry reconnects an existing child instead of duplicating it", () => {
  const state = fixture();
  createChildren(context, state.request);
  state.linked.length = 0;
  createChildren(context, state.request);
  assert.equal(state.issues.length, 3);
  assert.equal(state.linked.length, 2);
});
test("generated child discovery inherits approved context and is claimed once under its writer", () => {
  const state = fixture();
  createChildren(context, state.request);
  const childContext = { ...context, issueNumber: "2" };
  assert.equal(
    resolveChildDiscovery(childContext, state.request).role,
    "planner"
  );
  assert.equal(claimChildDiscovery(childContext, state.request), true);
  assert.equal(claimChildDiscovery(childContext, state.request), false);
  assert.equal(state.comments.get(2).length, 1);
});
test("forged senders cannot start child discovery", () => {
  assert.throws(
    () =>
      resolveChildDiscovery({ ...context, senderLogin: "human" }, () =>
        assert.fail("Unexpected API call")
      ),
    /Untrusted/
  );
});
test("removed parent authorization and edited child scope stop work", () => {
  const state = fixture();
  createChildren(context, state.request);
  const issue = state.issues[1];
  state.parent.labels = [];
  assert.throws(
    () => verifyInheritance(context, issue, state.request),
    /authorization/
  );
  state.parent.labels = [{ name: "ready for dev" }];
  issue.body += "\nExpand scope.";
  assert.throws(
    () => verifyInheritance(context, issue, state.request),
    /no longer matches/
  );
});
test("detaching a child from its native parent invalidates inherited authority", () => {
  const state = fixture();
  createChildren(context, state.request);
  state.linked.length = 0;
  assert.throws(
    () => verifyInheritance(context, state.issues[1], state.request),
    /no longer belongs/
  );
});

test("native prerequisites must match the reviewed decomposition", () => {
  const state = fixture();
  createChildren(context, state.request);
  state.dependencies.set(3, [{ id: 999 }]);
  assert.throws(
    () => verifyInheritance(context, state.issues[2], state.request),
    /prerequisites changed/
  );
});

test("editing the original parent checkpoint invalidates child provenance", () => {
  const state = fixture();
  createChildren(context, state.request);
  const checkpoint = state.comments.get(1)[0];
  checkpoint.body += "\nChanged shared contract";
  assert.throws(
    () => verifyInheritance(context, state.issues[1], state.request),
    /original parent deliverable/
  );
});

test("parent progress accepts only child merges into their parent branch", () => {
  const state = fixture();
  createChildren(context, state.request);
  const pull = {
    base: { ref: "claude/issue-1", repo: { full_name: context.repository } },
    head: { ref: "claude/issue-2", repo: { full_name: context.repository } },
    merged_at: "2026-09-10T12:00:00Z",
    user: { login: context.appLogin }
  };
  const request = (value) => (options) =>
    options.path.includes("/pulls/") ? value : state.request(options);
  const routeContext = { ...context, pullRequestNumber: "7" };
  assert.equal(parentProgressRoute(routeContext, request(pull)).issue, "1");
  for (const changed of [
    { ...pull, merged_at: null },
    { ...pull, user: { login: "human" } },
    { ...pull, base: { ...pull.base, ref: "feature" } },
    { ...pull, head: { ...pull.head, repo: { full_name: "foreign/repo" } } }
  ]) {
    assert.equal(parentProgressRoute(routeContext, request(changed)).role, "");
  }
});

test("duplicate or abandoned children require reconciliation instead of new issues", () => {
  const state = fixture();
  createChildren(context, state.request);
  state.issues[1].state = "closed";
  state.issues[1].state_reason = "not_planned";
  assert.throws(
    () => createChildren(context, state.request),
    /closed without delivery/
  );
  state.issues[1].state = "open";
  state.issues.push({ ...state.issues[1], id: 500, number: 5 });
  assert.throws(
    () => createChildren(context, state.request),
    /Duplicate child/
  );
});

test("a new parent revision can replan existing children without changing original requests", () => {
  const state = stackFixture();
  const issue = state.issues[1];
  const original = issue.body;
  const comments = state.comments.get(1);
  const body = comments[0].body
    .slice("<!-- hogasi-ai proposal -->\n".length)
    .replace(
      "Shared parent goal",
      "Integrate both children through a parent PR"
    );
  const digest = createHash("sha256").update(`30\n${body}`).digest("hex");
  comments.push({
    ...comments[0],
    body: `<!-- hogasi-ai proposal -->\n${body}`,
    id: 30
  });
  comments[1].body = '<!-- hogasi-ai planning {"proposal":30} -->';
  comments.push({
    ...comments[2],
    body: `<!-- hogasi-ai authorization ${JSON.stringify({ actor: "owner", digest, event: 20, proposal: 30 })} -->`,
    id: 32
  });
  const childContext = { ...context, issueNumber: "2" };
  assert.throws(
    () => verifyInheritance(childContext, issue, state.request),
    /Inherited parent decisions changed/
  );
  assert.equal(claimChildDiscovery(childContext, state.request), true);
  assert.equal(claimChildDiscovery(childContext, state.request), false);
  assert.ok(
    state.writes.some(
      (write) =>
        write.method === "DELETE" &&
        write.path.endsWith("/labels/ready%20for%20dev")
    )
  );
  issue.labels = [];
  const snapshot = capturePlanning(childContext, state.request);
  publishPlanning(
    {
      ...childContext,
      result: {
        deliverables: [],
        kind: "proposal",
        proposal: "Same child scope, integrated into the parent branch.",
        summary: "Updated parent reference."
      },
      snapshot
    },
    state.request
  );
  assert.equal(issue.body, original);
  assert.equal(
    state.comments
      .get(2)
      .filter((comment) =>
        comment.body.startsWith("<!-- hogasi-ai proposal -->")
      ).length,
    2
  );
  assert.doesNotThrow(() =>
    verifyInheritance(childContext, issue, state.request)
  );
  assert.throws(
    () => readApprovedProposal(childContext, state.request),
    /ready for dev/
  );
  createChildren(context, state.request);
  assert.equal(state.issues.length, 3);
});
