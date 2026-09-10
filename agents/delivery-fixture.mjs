/* eslint-disable max-lines-per-function -- Shared in-memory GitHub fixture; production functions retain the normal limit. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { appendDeliveryPlan } from "./delivery-plan.mjs";
import { appendInheritance, readInheritance } from "./delivery-scope.mjs";
import { createChildren } from "./delivery.mjs";

export const context = {
  appLogin: "builder[bot]",
  ciWorkflow: ".github/workflows/ci.yml",
  defaultBranch: "main",
  issueNumber: "1",
  repository: "org/repo",
  reviewerLogin: "reviewer[bot]",
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
export function fixture() {
  const body = appendDeliveryPlan("Shared parent goal", definitions);
  const digest = createHash("sha256").update(`10\n${body}`).digest("hex");
  const parent = {
    body: "Original parent request",
    id: 100,
    labels: [{ name: "ready for dev" }],
    number: 1,
    state: "open",
    title: "Shared parent goal",
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
      return [comments.get(number)];
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
    return path.endsWith("/labels") ? issue.labels : issue;
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
      comments.set(issue.number, []);
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
          created_at: "2026-09-10T14:00:00Z",
          id:
            Math.max(
              50,
              ...comments
                .values()
                .toArray()
                .flat()
                .map((comment) => comment.id)
            ) + 1,
          updated_at: "2026-09-10T14:00:00Z",
          user: { login: context.appLogin }
        }
      ]);
      return comments.get(number).at(-1);
    }
    return {};
  };
  return { comments, dependencies, issues, linked, parent, request, writes };
}

export function stackFixture() {
  const state = fixture();
  createChildren(context, state.request);
  authorize(state, 2);
  authorize(state, 3);
  const pull = {
    base: {
      ref: "claude/issue-1",
      repo: { full_name: context.repository },
      sha: "b".repeat(40)
    },
    draft: false,
    head: {
      ref: "claude/issue-2",
      repo: { full_name: context.repository },
      sha: "a".repeat(40)
    },
    number: 7,
    state: "open",
    user: { login: context.appLogin }
  };
  const upper = {
    ...structuredClone(pull),
    base: {
      ...structuredClone(pull.base),
      ref: pull.head.ref,
      sha: pull.head.sha
    },
    head: {
      ...structuredClone(pull.head),
      ref: "claude/issue-3",
      sha: "c".repeat(40)
    },
    number: 8
  };
  const request = (options) => {
    if (options.path.includes("/pulls?")) {
      return [
        [structuredClone(options.path.includes("issue-2") ? pull : upper)]
      ];
    }
    if (options.path.endsWith("/pulls/7")) {
      return structuredClone(pull);
    }
    if (options.path.endsWith("/pulls/8")) {
      return structuredClone(upper);
    }
    return state.request(options);
  };
  return { ...state, pull, request, upper };
}

function authorize(state, number) {
  const issue = state.issues.find((entry) => entry.number === number);
  issue.labels = [{ name: "ready for dev" }];
  const id = 1000 + number;
  const body = appendInheritance(
    `Reviewed child ${number} scope`,
    readInheritance(
      { ...context, issueNumber: String(number) },
      issue,
      state.request
    )
  );
  const digest = createHash("sha256").update(`${id}\n${body}`).digest("hex");
  state.comments.set(
    number,
    [
      {
        body: `<!-- hogasi-ai proposal -->\n${body}`,
        created_at: "2026-09-10T12:00:00Z",
        id,
        updated_at: "2026-09-10T12:00:00Z"
      },
      {
        body: `<!-- hogasi-ai planning ${JSON.stringify({ proposal: id })} -->`,
        id: id + 10
      },
      {
        body: `<!-- hogasi-ai authorization ${JSON.stringify({ actor: "owner", digest, event: 20, proposal: id })} -->`,
        id: id + 20
      }
    ].map((comment) => ({ ...comment, user: { login: context.appLogin } }))
  );
}
