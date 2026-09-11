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
    if (options.path.includes("/git/ref/heads/")) {
      const refs = new Map([
        [state.pull.base.ref, state.pull.base.sha],
        [state.pull.head.ref, state.pull.head.sha]
      ]);
      return {
        object: { sha: refs.get(options.path.split("/git/ref/heads/", 2)[1]) }
      };
    }
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
    return state.request(options);
  };
  await refreshStack(childContext, {
    callGitHub: request,
    merge: (options) => {
      updates.push(options);
      state.upper.head.sha = "d".repeat(40);
    }
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].head, head);
  assert.equal(updates[0].base, state.pull.head.sha);
});

test("downstream refresh uses the live prerequisite when GitHub caches an older base SHA", async () => {
  const state = nativeFixture();
  registerStack(childContext, state.request);
  state.pull.head.sha = "e".repeat(40);
  const initialHead = state.upper.head.sha;
  const updates = [];
  const request = (options) => {
    if (options.path.includes("/compare/")) {
      return {
        status: options.path.endsWith(`${state.pull.head.sha}...${initialHead}`)
          ? "diverged"
          : "ahead"
      };
    }
    return state.request(options);
  };
  await refreshStack(childContext, {
    callGitHub: request,
    merge: (options) => {
      updates.push(options);
      state.upper.head.sha = "d".repeat(40);
    }
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].head, initialHead);
  assert.equal(updates[0].base, state.pull.head.sha);
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
    refreshStack(childContext, {
      callGitHub: request,
      merge: () => assert.fail("must not merge")
    }),
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
    return state.request(options);
  };
  await assert.rejects(
    refreshStack(childContext, {
      callGitHub: request,
      merge: () => {
        throw new Error("merge conflict");
      }
    }),
    /merge conflict/
  );
  assert.ok(writes.some((entry) => entry.body?.labels?.includes("blocked")));
  assert.equal(writes.filter((entry) => entry.method === "PUT").length, 0);
  assert.equal(
    writes.some((entry) => entry.path.includes("/git/refs")),
    false
  );
});

test("a verified refresh clears the child's stale blocked status", async () => {
  const state = nativeFixture();
  registerStack(childContext, state.request);
  let labels = [{ name: "ready for dev" }, { name: "blocked" }];
  const request = (options) => {
    const path = "repos/org/repo/issues/3/labels";
    if (options.path === path && !options.method) {
      return labels;
    }
    if (options.path === `${path}/blocked` && options.method === "DELETE") {
      labels = labels.filter((label) => label.name !== "blocked");
      return {};
    }
    if (options.path === path && options.method === "POST") {
      labels = [...labels, ...options.body.labels.map((name) => ({ name }))];
      return {};
    }
    if (options.path.includes("/compare/")) {
      return { status: "ahead" };
    }
    return state.request(options);
  };
  await refreshStack(childContext, { callGitHub: request });
  assert.deepEqual(
    labels.map((label) => label.name),
    ["ready for dev", "in development"]
  );
});
