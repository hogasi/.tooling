import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { requireDependencies } from "./delivery-evidence.mjs";
import { appendDeliveryPlan } from "./delivery-plan.mjs";
import { parentProgressRoute, refreshDelivery } from "./delivery-progress.mjs";
import { verifyInheritance } from "./delivery-scope.mjs";
import {
  claimChildDiscovery,
  createChildren,
  resolveChildDiscovery
} from "./delivery.mjs";

const context = {
  appLogin: "builder[bot]",
  defaultBranch: "main",
  issueNumber: "1",
  repository: "org/repo",
  runId: "100",
  senderLogin: "builder[bot]",
  sourceRunId: "99"
};
const definitions = [
  {
    body: "Deliver and test the first independent outcome.",
    dependsOn: [],
    key: "first",
    title: "First outcome"
  },
  {
    body: "Deliver and test the second outcome using the first contract.",
    dependsOn: ["first"],
    key: "second",
    title: "Second outcome"
  }
];
function fixture() {
  const body = appendDeliveryPlan("Shared parent goal", definitions);
  const digest = createHash("sha256").update(`10\n${body}`).digest("hex");
  const parent = {
    body: "Original parent request",
    id: 100,
    labels: [{ name: "ready for dev" }],
    number: 1,
    state: "open",
    user: { login: "owner" }
  };
  const comments = new Map([
    [
      1,
      [
        {
          body: `<!-- hogasi-ai proposal -->\n${body}`,
          created_at: "2026-09-10T10:00:00Z",
          id: 10,
          updated_at: "2026-09-10T10:00:00Z"
        },
        { body: '<!-- hogasi-ai planning {"proposal":10} -->', id: 11 },
        {
          body: `<!-- hogasi-ai authorization ${JSON.stringify({ actor: "owner", digest, event: 20, proposal: 10 })} -->`,
          id: 12
        }
      ].map((comment) => ({ ...comment, user: { login: context.appLogin } }))
    ]
  ]);
  const issues = [parent];
  const linked = [];
  const dependencies = new Map();
  const writes = [];
  const read = (path) => {
    if (path.includes("?state=all")) {
      return [issues];
    }
    const fixed = new Map([
      [
        "repos/org/repo/actions/runs/99",
        {
          actor: { login: "owner" },
          event: "issues",
          path: ".github/workflows/ai.yml"
        }
      ],
      [
        "repos/org/repo/collaborators/owner/permission",
        { permission: "write" }
      ],
      ["repos/org/repo/issues/1/sub_issues", [linked]]
    ]);
    if (fixed.has(path)) {
      return fixed.get(path);
    }
    const number = Number(path.split("/", 5)[4]);
    if (path.endsWith("/comments")) {
      return [comments.get(number) ?? []];
    }
    if (path.endsWith("/events")) {
      return [[{ event: "labeled", id: 20, label: { name: "ready for dev" } }]];
    }
    if (path.endsWith("/blocked_by")) {
      return [
        (dependencies.get(number) ?? []).map(
          (entry) => issues.find((issue) => issue.id === entry.id) ?? entry
        )
      ];
    }
    const issue = issues.find((entry) => entry.number === number);
    assert.ok(issue, path);
    return issue;
  };
  const request = (options) => {
    if (!options.method) {
      return read(options.path);
    }
    writes.push(options);
    return write(options);
  };
  const write = (options) => {
    const number = Number(options.path.split("/", 5)[4]);
    if (options.path === "repos/org/repo/issues") {
      const issue = {
        ...options.body,
        id: 100 + issues.length,
        labels: [],
        number: 1 + issues.length,
        state: "open",
        user: { login: context.appLogin }
      };
      issues.push(issue);
      return issue;
    }
    if (options.path.endsWith("/sub_issues")) {
      linked.push(
        issues.find((issue) => issue.id === options.body.sub_issue_id)
      );
    } else if (options.path.endsWith("/blocked_by")) {
      dependencies.set(number, [
        ...(dependencies.get(number) ?? []),
        { id: options.body.issue_id }
      ]);
    } else if (options.method === "PATCH") {
      const comment = comments
        .values()
        .toArray()
        .flat()
        .find((entry) => options.path.endsWith(`/${entry.id}`));
      comment.body = options.body.body;
    } else if (options.path.endsWith("/comments")) {
      comments.set(number, [
        ...(comments.get(number) ?? []),
        {
          body: options.body.body,
          id: 50 + writes.length,
          user: { login: context.appLogin }
        }
      ]);
    }
    return {};
  };
  return { comments, dependencies, issues, linked, parent, request, writes };
}

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

test("a dependent child cannot implement before its prerequisite reaches main", () => {
  const state = fixture();
  createChildren(context, state.request);
  assert.throws(
    () => requireDependencies(context, state.issues[2], state.request),
    /not delivered/
  );
  state.issues[1].state = "closed";
  const request = (options) =>
    options.path.includes("/pulls?") ? [[]] : state.request(options);
  assert.throws(
    () => requireDependencies(context, state.issues[2], request),
    /not delivered/
  );
});

test("a verified prerequisite merge releases its dependent child", () => {
  const state = fixture();
  createChildren(context, state.request);
  state.issues[1].state = "closed";
  const request = (options) =>
    options.path.includes("/pulls?")
      ? [
          [
            {
              base: { ref: "main", repo: { full_name: context.repository } },
              head: {
                ref: "claude/issue-2",
                repo: { full_name: context.repository }
              },
              merged_at: "2026-09-10T12:00:00Z",
              number: 7,
              user: { login: context.appLogin }
            }
          ]
        ]
      : state.request(options);
  assert.doesNotThrow(() =>
    requireDependencies(context, state.issues[2], request)
  );
  refreshDelivery(context, request);
  const summary = state.comments
    .get(1)
    .find((comment) => comment.body.startsWith("<!-- hogasi-ai delivery "));
  assert.match(summary.body, /\[x\] #2/);
  assert.match(summary.body, /\[ \] #3/);
  assert.equal(state.parent.state, "open");
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

test("a changed parent checkpoint invalidates inherited scope", () => {
  const state = fixture();
  createChildren(context, state.request);
  const checkpoint = state.comments.get(1)[0];
  checkpoint.body += "\nChanged shared contract";
  assert.throws(
    () => verifyInheritance(context, state.issues[1], state.request),
    /Inherited parent decisions changed/
  );
});

test("parent progress ignores unmerged, foreign and non-default-branch PRs", () => {
  const state = fixture();
  createChildren(context, state.request);
  const pull = {
    base: { ref: "main", repo: { full_name: context.repository } },
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
