import assert from "node:assert/strict";
import test from "node:test";

import { context, stackFixture } from "./delivery-fixture.mjs";
import { refreshStack } from "./stack-refresh.mjs";
import { registerStack } from "./stack.mjs";

const childContext = {
  ...context,
  expectedWriter: "1",
  issueNumber: "3",
  pullRequestNumber: "8"
};

function nativeFixture() {
  const state = stackFixture();
  const stack = {
    base: { ref: "claude/issue-1" },
    number: 1,
    pull_requests: [{ number: 7 }, { number: 8 }]
  };
  const writes = [];
  const request = (options) => {
    if (options.method === "POST" && options.path.endsWith("/stacks")) {
      writes.push(options);
      state.pull.stack = { base: { ref: "claude/issue-1" }, number: 1 };
      state.upper.stack = structuredClone(state.pull.stack);
      return structuredClone(stack);
    }
    if (options.path.endsWith("/stacks/1")) {
      return structuredClone(stack);
    }
    return state.request(options);
  };
  return { ...state, request, stack, writes };
}

test("native stack creation is ordered and an identical retry does not create another stack", () => {
  const state = nativeFixture();
  assert.equal(registerStack(childContext, state.request).stack.number, 1);
  assert.deepEqual(state.writes[0].body, { pull_requests: [7, 8] });
  registerStack(childContext, state.request);
  assert.equal(state.writes.length, 1);
});

test("an unrelated native stack cannot replace the recorded dependency", () => {
  const state = nativeFixture();
  registerStack(childContext, state.request);
  state.stack.pull_requests = [{ number: 9 }, { number: 8 }];
  assert.throws(
    () => registerStack(childContext, state.request),
    /differs from the approved dependency/
  );
});

test("downstream refresh uses the exact current head and waits for merged base evidence", async () => {
  const state = nativeFixture();
  registerStack(childContext, state.request);
  const head = state.upper.head.sha;
  const updates = [];
  const request = (options) => {
    if (options.path.includes("/compare/")) {
      return { status: options.path.endsWith(head) ? "diverged" : "ahead" };
    }
    if (options.path.endsWith("/update-branch")) {
      updates.push(options);
      state.upper.head.sha = "d".repeat(40);
      return { message: "Updating pull request branch." };
    }
    return state.request(options);
  };
  await refreshStack(childContext, request);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].body, { expected_head_sha: head });
});

test("a concurrent stack head edit stops refresh without overwriting the new commit", async () => {
  const state = nativeFixture();
  registerStack(childContext, state.request);
  let reads = 0;
  const writes = [];
  const request = (options) => {
    if (options.method) {
      writes.push(options);
    }
    if (options.path.endsWith("/pulls/7")) {
      reads += 1;
      if (reads === 2) {
        state.pull.head.sha = "f".repeat(40);
      }
    }
    return state.request(options);
  };
  await assert.rejects(
    refreshStack(childContext, request),
    /Concurrent PR changes/
  );
  assert.equal(state.pull.head.sha, "f".repeat(40));
  assert.equal(
    writes.some((entry) => entry.path.endsWith("/update-branch")),
    false
  );
});

test("a branch conflict blocks the affected child and never force-pushes", async () => {
  const state = nativeFixture();
  registerStack(childContext, state.request);
  const writes = [];
  const request = (options) => {
    if (options.method) {
      writes.push(options);
    }
    if (options.path.includes("/compare/")) {
      return { status: "diverged" };
    }
    if (options.path.endsWith("/update-branch")) {
      throw new Error("GitHub 422: merge conflict");
    }
    return state.request(options);
  };
  await assert.rejects(refreshStack(childContext, request), /merge conflict/);
  assert.ok(writes.some((entry) => entry.body?.labels?.includes("blocked")));
  assert.equal(writes.filter((entry) => entry.method === "PUT").length, 1);
  assert.equal(
    writes.some((entry) => entry.path.includes("/git/refs")),
    false
  );
});
